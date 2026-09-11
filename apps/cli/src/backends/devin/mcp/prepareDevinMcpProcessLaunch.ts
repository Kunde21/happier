import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { McpServerConfig } from '@/agent/core';
import {
  createProtectedLocalStateDirectory,
  createProtectedLocalStateFileExclusive,
  ensureProtectedLocalStateDirectory,
} from '@/utils/fs/protectedLocalState';
import { expandHomeDirPath, resolveHomeDirFromEnvironment } from '@/utils/path/expandHomeDirPath';

type EnvLike = Readonly<Record<string, string | undefined>>;

export function resolveDevinConfigPaths(env: EnvLike): Readonly<{
  configRoot: string;
  devinConfigDir: string;
  mainConfigPath: string;
  mcpConfigPath: string;
}> {
  const configuredRoot = env.XDG_CONFIG_HOME?.trim() ?? '';
  const configRoot = expandHomeDirPath(configuredRoot, env)
    || join(resolveHomeDirFromEnvironment(env), '.config');
  const devinConfigDir = join(configRoot, 'devin');
  return {
    configRoot,
    devinConfigDir,
    mainConfigPath: join(devinConfigDir, 'config.json'),
    mcpConfigPath: join(devinConfigDir, 'mcp_config.json'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readUserMcpConfig(path: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error('expected a JSON object');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse Devin MCP config at ${path}`, { cause: error });
  }
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function restoreMcpChildConfigEnvironment(
  value: unknown,
  originalConfigRoot: string,
): unknown {
  if (!isRecord(value) || typeof value.command !== 'string') return value;
  const existingEnv = isRecord(value.env) ? value.env : {};
  return {
    ...value,
    env: {
      XDG_CONFIG_HOME: originalConfigRoot,
      ...existingEnv,
    },
  };
}

function materializeSessionMcpServer(
  config: McpServerConfig,
  originalConfigRoot: string,
): Record<string, unknown> {
  return {
    command: config.command,
    args: config.args ?? [],
    env: {
      XDG_CONFIG_HOME: originalConfigRoot,
      ...config.env,
    },
    transport: 'stdio',
  };
}

export async function prepareDevinMcpProcessLaunch(params: Readonly<{
  processEnv: EnvLike;
  mcpServers: Readonly<Record<string, McpServerConfig>>;
}>): Promise<Readonly<{
  env: Readonly<Record<string, string>>;
  cleanup: () => Promise<void>;
}>> {
  const sourcePaths = resolveDevinConfigPaths(params.processEnv);
  const [userConfig, mainConfig] = await Promise.all([
    readUserMcpConfig(sourcePaths.mcpConfigPath),
    readOptionalFile(sourcePaths.mainConfigPath),
  ]);
  const userServers = isRecord(userConfig.mcpServers) ? userConfig.mcpServers : {};
  const mergedServers = Object.fromEntries([
    ...Object.entries(userServers).map(([name, config]) => [
      name,
      restoreMcpChildConfigEnvironment(config, sourcePaths.configRoot),
    ]),
    ...Object.entries(params.mcpServers).map(([name, config]) => [
      name,
      materializeSessionMcpServer(config, sourcePaths.configRoot),
    ]),
  ]);

  const overlayRoot = await createProtectedLocalStateDirectory(
    join(tmpdir(), 'happier-devin-acp-'),
  );
  try {
    const overlayDevinDir = join(overlayRoot, 'devin');
    await ensureProtectedLocalStateDirectory(overlayDevinDir);
    await createProtectedLocalStateFileExclusive(
      join(overlayDevinDir, 'mcp_config.json'),
      JSON.stringify({ ...userConfig, mcpServers: mergedServers }),
    );
    if (mainConfig !== null) {
      await createProtectedLocalStateFileExclusive(
        join(overlayDevinDir, 'config.json'),
        mainConfig,
      );
    }

    return {
      env: { XDG_CONFIG_HOME: overlayRoot },
      cleanup: async () => {
        await rm(overlayRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(overlayRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
