import {
  AGENTS_CORE,
  hasBuiltInAcpConfig,
  isBuiltInAcpSessionListingDeclared,
  type AgentId,
} from '@happier-dev/agents';

import type { AgentCatalogEntry } from '@/backends/types';

import { createCatalogDefinedCliAuthSpec } from './auth/createCatalogDefinedCliAuthSpec';
import { createCatalogDefinedAcpBackend } from './createCatalogDefinedAcpBackend';
import { createCatalogDefinedCliDetect } from './createCatalogDefinedCliDetect';

export function createCatalogDefinedAcpEntry(agentId: AgentId): AgentCatalogEntry {
  if (!hasBuiltInAcpConfig(agentId)) {
    throw new Error(`Agent '${agentId}' is not registered as a built-in generic ACP agent`);
  }

  const core = AGENTS_CORE[agentId];

  return {
    id: core.id,
    cliSubcommand: core.cliSubcommand,
    getCliCommandHandler: async () => {
      return async (context) => {
        const { handleCatalogDefinedAcpCliCommand } = await import('./handleCatalogDefinedAcpCliCommand');
        await handleCatalogDefinedAcpCliCommand(agentId, context);
      };
    },
    getCliDetect: async () => createCatalogDefinedCliDetect(agentId),
    getCliAuthSpec: async () => createCatalogDefinedCliAuthSpec(agentId),
    vendorResumeSupport: core.resume.vendorResume,
    getAcpBackendFactory: async () => {
      return (opts) => ({ backend: createCatalogDefinedAcpBackend(agentId, opts as never) });
    },
    // Resume-only session enumeration over ACP `session/list`, offered only where the leaf
    // declaration allows it. The live handshake still decides whether the call is dispatched.
    ...(isBuiltInAcpSessionListingDeclared(agentId)
      ? {
        getDirectSessionProviderOps: async () => {
          const { createAcpSessionListDirectSessionProviderOps } = await import(
            '@/backends/directSessions/acpSessionListProviderOps'
          );
          return createAcpSessionListDirectSessionProviderOps(agentId);
        },
      }
      : {}),
  };
}
