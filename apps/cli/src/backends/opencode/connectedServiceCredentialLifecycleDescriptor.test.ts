import { describe, expect, it } from 'vitest';

import { agent } from './index';

describe('OpenCode connected-service credential lifecycle descriptor', () => {
  it('advertises provider-owned broker hot apply without claiming in-turn exact identity', async () => {
    await expect(agent.getConnectedServiceCredentialLifecycleDescriptor()).resolves.toMatchObject({
      providerId: 'opencode',
      refreshedCredentialApplication: {
        mode: 'restart_required',
        noRestartRequiredServiceIds: ['openai-codex', 'claude-subscription'],
      },
      sameAccountFanoutStrategy: 'shared_group_auth_surface',
      predictiveSoftSwitch: { mode: 'supported' },
      runtimeAuthApply: {
        directLiveHotAuth: {
          supportsInTurnApply: false,
          requiresExactRuntimeIdentity: false,
          refreshSelectionResync: 'not_applicable',
          authMode: {
            kind: 'provider_owned',
            name: 'broker_selection_indirection',
          },
        },
      },
    });
  });

  it('advertises OpenCode Go API-key support that always requires a restart to apply', async () => {
    const descriptor = await agent.getConnectedServiceCredentialLifecycleDescriptor();
    expect(descriptor.serviceIds).toContain('opencode-go');
    expect(descriptor.refreshedCredentialApplication.noRestartRequiredServiceIds).not.toContain('opencode-go');
  });
});
