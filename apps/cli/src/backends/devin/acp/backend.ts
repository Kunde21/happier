import { createCatalogDefinedAcpBackend, type CatalogDefinedAcpBackendOptions } from '@/agent/acp/catalog/createCatalogDefinedAcpBackend';
import type { AgentBackend } from '@/agent/core';

import { prepareDevinMcpProcessLaunch } from '../mcp/prepareDevinMcpProcessLaunch';
import { devinSessionModelAdapter } from './modelControls';

export type DevinBackendOptions = CatalogDefinedAcpBackendOptions;

export function createDevinBackend(options: DevinBackendOptions): AgentBackend {
  const mcpServers = options.mcpServers ?? {};
  const processEnv = { ...process.env, ...options.env };
  return createCatalogDefinedAcpBackend('devin', {
    ...options,
    sessionModelAdapter: devinSessionModelAdapter,
    prepareProcessLaunch: async () => prepareDevinMcpProcessLaunch({
      cwd: options.cwd,
      processEnv,
      mcpServers,
    }),
  });
}
