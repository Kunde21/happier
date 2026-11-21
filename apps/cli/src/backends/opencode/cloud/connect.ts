import type { CloudConnectTarget } from '@/cloud/connectTypes';
import { AGENTS_CORE } from '@happier-dev/agents';

/**
 * OpenCode Go connect target: token-only (Console API key, service id `opencode-go`).
 * There is no OAuth flow in this build; `happier connect opencode --api-key` stores
 * the key through the shared connected-service credential path.
 */
export const openCodeCloudConnect: CloudConnectTarget = {
  id: 'opencode',
  displayName: 'OpenCode',
  vendorDisplayName: 'OpenCode Go',
  vendorKey: AGENTS_CORE.opencode.cloudConnect!.vendorKey,
  status: AGENTS_CORE.opencode.cloudConnect!.status,
  authenticate: async () => {
    throw new Error('OpenCode Go is connected with an API key. Use: happier connect opencode --api-key');
  },
};
