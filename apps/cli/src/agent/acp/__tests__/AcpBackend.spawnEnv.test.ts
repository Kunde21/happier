import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';

import { AcpBackend } from '../AcpBackend';
import { writeAcpTestAgentScript } from '../testkit/subprocessHarness';

const envScope = createEnvKeyScope(['GEMINI_MODEL', 'Gemini_Model', 'gemini_model']);
const preservedEnvKey = 'HAPPIER_ACP_ENV_PRESERVED_KEY';

afterEach(() => {
  envScope.restore();
});

function writeEnvCapturingAcpAgentScript(params: { dir: string }): string {
  const source = `
    const { writeFileSync } = require('node:fs');
    const decoder = new TextDecoder();
    let buf = '';

    function send(obj) {
      process.stdout.write(JSON.stringify(obj) + '\\n');
    }

    function respondOk(id, result) {
      send({ jsonrpc: '2.0', id, result });
    }

    const capturePath = process.env.HAPPIER_ACP_ENV_CAPTURE_PATH;
    if (capturePath) {
      writeFileSync(capturePath, JSON.stringify({
        GEMINI_MODEL: Object.prototype.hasOwnProperty.call(process.env, 'GEMINI_MODEL')
          ? process.env.GEMINI_MODEL
          : null,
        Gemini_Model: Object.prototype.hasOwnProperty.call(process.env, 'Gemini_Model')
          ? process.env.Gemini_Model
          : null,
        gemini_model: Object.prototype.hasOwnProperty.call(process.env, 'gemini_model')
          ? process.env.gemini_model
          : null,
        [${JSON.stringify(preservedEnvKey)}]: Object.prototype.hasOwnProperty.call(process.env, ${JSON.stringify(preservedEnvKey)})
          ? process.env[${JSON.stringify(preservedEnvKey)}]
          : null,
      }));
    }

    process.stdin.on('data', (chunk) => {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split('\\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const req = JSON.parse(trimmed);
        if (!req || typeof req !== 'object') continue;
        const id = req.id;
        const method = req.method;
        if (id === undefined || id === null || typeof method !== 'string') continue;

        if (method === 'initialize') {
          respondOk(id, { protocolVersion: 1 });
          continue;
        }

        if (method === 'session/new') {
          respondOk(id, { sessionId: 'test-session' });
          continue;
        }

        respondOk(id, {});
      }
    });
  `;

  return writeAcpTestAgentScript({
    dir: params.dir,
    fileName: 'env-capturing-acp-agent.cjs',
    source,
  });
}

function writeFailingNewSessionAcpAgentScript(params: { dir: string }): string {
  return writeAcpTestAgentScript({
    dir: params.dir,
    fileName: 'failing-new-session-acp-agent.cjs',
    source: `
      const readline = require('node:readline');
      const lines = readline.createInterface({ input: process.stdin });
      const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
      lines.on('line', (line) => {
        const request = JSON.parse(line);
        if (request.method === 'initialize') {
          send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1 } });
          return;
        }
        if (request.method === 'session/new') {
          send({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'new session failed' } });
        }
      });
    `,
  });
}

describe('AcpBackend spawn environment', () => {
  it('applies an asynchronous process-launch environment and cleans it up on dispose', async () => {
    await withTempDir('happier-acp-spawn-env-', async (dir) => {
      const capturePath = join(dir, 'spawn-env.json');
      const scriptPath = writeEnvCapturingAcpAgentScript({ dir });
      const cleanup = vi.fn(async () => {});
      const prepareProcessLaunch = vi.fn(async () => ({
        env: { [preservedEnvKey]: 'prepared-value' },
        cleanup,
      }));

      const backend = new AcpBackend({
        agentName: 'test',
        cwd: dir,
        command: process.execPath,
        args: [scriptPath],
        env: { HAPPIER_ACP_ENV_CAPTURE_PATH: capturePath },
        prepareProcessLaunch,
      });

      await backend.startSession();
      expect(JSON.parse(readFileSync(capturePath, 'utf8'))[preservedEnvKey]).toBe('prepared-value');
      expect(prepareProcessLaunch).toHaveBeenCalledTimes(1);
      expect(cleanup).not.toHaveBeenCalled();

      await backend.dispose();
      expect(cleanup).toHaveBeenCalledTimes(1);
      await backend.dispose();
      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  }, 20_000);

  it('cleans prepared launch state after session creation fails and prepares a retry afresh', async () => {
    await withTempDir('happier-acp-spawn-env-', async (dir) => {
      const scriptPath = writeFailingNewSessionAcpAgentScript({ dir });
      const cleanup = vi.fn(async () => {});
      const prepareProcessLaunch = vi.fn(async () => ({ cleanup }));
      const backend = new AcpBackend({
        agentName: 'test',
        cwd: dir,
        command: process.execPath,
        args: [scriptPath],
        prepareProcessLaunch,
      });

      try {
        await expect(backend.startSession()).rejects.toThrow(/new session failed/i);
        await expect(backend.startSession()).rejects.toThrow(/new session failed/i);
        expect(prepareProcessLaunch).toHaveBeenCalledTimes(2);
        expect(cleanup).toHaveBeenCalledTimes(2);
      } finally {
        await backend.dispose();
      }
    });
  }, 20_000);

  it('removes configured inherited environment variables before spawning', async () => {
    await withTempDir('happier-acp-spawn-env-', async (dir) => {
      envScope.patch({
        GEMINI_MODEL: 'host-model',
        Gemini_Model: 'mixed-case-host-model',
        gemini_model: 'lowercase-host-model',
      });
      const capturePath = join(dir, 'spawn-env.json');
      const scriptPath = writeEnvCapturingAcpAgentScript({ dir });

      const backend = new AcpBackend({
        agentName: 'test',
        cwd: dir,
        command: process.execPath,
        args: [scriptPath],
        env: { HAPPIER_ACP_ENV_CAPTURE_PATH: capturePath },
        unsetEnv: ['GEMINI_MODEL'],
      });

      try {
        await backend.startSession();

        expect(JSON.parse(readFileSync(capturePath, 'utf8'))).toEqual({
          GEMINI_MODEL: null,
          Gemini_Model: null,
          gemini_model: null,
          [preservedEnvKey]: null,
        });
      } finally {
        await backend.dispose();
      }
    });
  }, 20_000);

  it('preserves explicit environment overrides after removing inherited variants', async () => {
    await withTempDir('happier-acp-spawn-env-', async (dir) => {
      envScope.patch({
        GEMINI_MODEL: 'host-model',
        Gemini_Model: 'mixed-case-host-model',
        gemini_model: 'lowercase-host-model',
      });
      const capturePath = join(dir, 'spawn-env.json');
      const scriptPath = writeEnvCapturingAcpAgentScript({ dir });

      const backend = new AcpBackend({
        agentName: 'test',
        cwd: dir,
        command: process.execPath,
        args: [scriptPath],
        env: {
          HAPPIER_ACP_ENV_CAPTURE_PATH: capturePath,
          GEMINI_MODEL: 'scoped-exact-model',
          Gemini_Model: 'scoped-mixed-case-model',
          gemini_model: 'scoped-lowercase-model',
          [preservedEnvKey]: 'preserved-scoped-value',
        },
        unsetEnv: ['GEMINI_MODEL'],
      });

      try {
        await backend.startSession();

        expect(JSON.parse(readFileSync(capturePath, 'utf8'))).toEqual({
          GEMINI_MODEL: 'scoped-exact-model',
          Gemini_Model: 'scoped-mixed-case-model',
          gemini_model: 'scoped-lowercase-model',
          [preservedEnvKey]: 'preserved-scoped-value',
        });
      } finally {
        await backend.dispose();
      }
    });
  }, 20_000);
});
