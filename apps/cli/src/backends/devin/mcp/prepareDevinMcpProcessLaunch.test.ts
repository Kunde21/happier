import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withTempDir } from '@/testkit/fs/tempDir';

import {
  prepareDevinMcpProcessLaunch,
  resolveDevinConfigPaths,
} from './prepareDevinMcpProcessLaunch';

describe('prepareDevinMcpProcessLaunch', () => {
  it('merges user and session MCP servers into an isolated Devin config and restores child XDG config', async () => {
    await withTempDir('happier-devin-user-config-', async (userConfigRoot) => {
      const sourcePaths = resolveDevinConfigPaths({
        HOME: join(userConfigRoot, 'home'),
        XDG_CONFIG_HOME: userConfigRoot,
      });
      await mkdir(sourcePaths.devinConfigDir, { recursive: true });
      await writeFile(sourcePaths.mainConfigPath, '{"theme":"dark"}', 'utf8');
      await writeFile(sourcePaths.mcpConfigPath, JSON.stringify({
        untouched: { enabled: true },
        mcpServers: {
          native: {
            command: 'native-mcp',
            args: ['serve'],
            env: { NATIVE_SECRET: 'secret' },
            transport: 'stdio',
          },
          collision: { command: 'old-command', transport: 'stdio' },
          remote: { url: 'https://example.test/mcp', transport: 'http' },
        },
      }), 'utf8');

      const prepared = await prepareDevinMcpProcessLaunch({
        processEnv: {
          HOME: join(userConfigRoot, 'home'),
          XDG_CONFIG_HOME: userConfigRoot,
        },
        mcpServers: {
          collision: { command: 'happier-mcp', args: ['bridge'] },
          explicitXdg: {
            command: 'custom-mcp',
            env: { XDG_CONFIG_HOME: '/custom/mcp/config' },
          },
        },
      });

      try {
        expect(prepared.env.XDG_CONFIG_HOME).not.toBe(userConfigRoot);
        expect(await readFile(join(prepared.env.XDG_CONFIG_HOME, 'devin', 'config.json'), 'utf8'))
          .toBe('{"theme":"dark"}');
        const overlayPath = join(prepared.env.XDG_CONFIG_HOME, 'devin', 'mcp_config.json');
        const overlay = JSON.parse(await readFile(overlayPath, 'utf8'));

        expect(overlay.untouched).toEqual({ enabled: true });
        expect(overlay.mcpServers.remote).toEqual({
          url: 'https://example.test/mcp',
          transport: 'http',
        });
        expect(overlay.mcpServers.native).toEqual({
          command: 'native-mcp',
          args: ['serve'],
          env: {
            XDG_CONFIG_HOME: userConfigRoot,
            NATIVE_SECRET: 'secret',
          },
          transport: 'stdio',
        });
        expect(overlay.mcpServers.collision).toEqual({
          command: 'happier-mcp',
          args: ['bridge'],
          env: { XDG_CONFIG_HOME: userConfigRoot },
          transport: 'stdio',
        });
        expect(overlay.mcpServers.explicitXdg.env.XDG_CONFIG_HOME).toBe('/custom/mcp/config');

        expect(JSON.parse(await readFile(sourcePaths.mcpConfigPath, 'utf8')).mcpServers.collision.command)
          .toBe('old-command');
      } finally {
        await prepared.cleanup();
      }

      expect(existsSync(prepared.env.XDG_CONFIG_HOME)).toBe(false);
    });
  });

  it('fails loudly when the user MCP config is malformed', async () => {
    await withTempDir('happier-devin-user-config-', async (userConfigRoot) => {
      const paths = resolveDevinConfigPaths({ HOME: userConfigRoot, XDG_CONFIG_HOME: userConfigRoot });
      await mkdir(paths.devinConfigDir, { recursive: true });
      await writeFile(paths.mcpConfigPath, '{not-json', 'utf8');

      await expect(prepareDevinMcpProcessLaunch({
        processEnv: { HOME: userConfigRoot, XDG_CONFIG_HOME: userConfigRoot },
        mcpServers: { happier: { command: 'happier-mcp' } },
      })).rejects.toThrow(/Devin MCP config/);
    });
  });
});
