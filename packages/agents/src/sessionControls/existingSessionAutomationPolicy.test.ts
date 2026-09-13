import { describe, expect, it } from 'vitest';

import { evaluateExistingSessionAutomationEligibility } from './existingSessionAutomationPolicy.js';

describe('evaluateExistingSessionAutomationEligibility', () => {
  it('accepts vendor-resumable sessions with a persisted resume id', () => {
    expect(
      evaluateExistingSessionAutomationEligibility({
        metadata: {
          flavor: 'claude',
          claudeSessionId: 'claude-session-1',
        },
      }),
    ).toEqual({
      eligible: true,
      agentId: 'claude',
      strategy: 'vendor_resume',
    });
  });

  it('accepts Pi sessions with a persisted resume id', () => {
    expect(
      evaluateExistingSessionAutomationEligibility({
        metadata: {
          flavor: 'pi',
          piSessionId: 'pi-session-1',
        },
      }),
    ).toEqual({
      eligible: true,
      agentId: 'pi',
      strategy: 'vendor_resume',
    });
  });

  it('accepts configured ACP sessions only when exact identity and static load policy agree', () => {
    expect(
      evaluateExistingSessionAutomationEligibility({
        metadata: {
          flavor: 'acp:custom-backend',
          acpConfiguredBackendV1: {
            v: 1,
            updatedAt: 1,
            backendId: 'custom-backend',
            title: 'Custom backend',
          },
          customAcpSessionId: 'provider-session-1',
        },
        accountSettings: {
          acpCatalogSettingsV1: {
            v: 2,
            backends: [{
              id: 'custom-backend',
              name: 'custom-backend',
              title: 'Custom backend',
              command: 'custom-agent',
              args: [],
              env: {},
              transportProfile: 'generic',
              capabilities: {
                supportsLoadSession: true,
                supportsModes: 'unknown',
                supportsModels: 'unknown',
                supportsConfigOptions: 'unknown',
                promptImageSupport: 'unknown',
              },
              createdAt: 1,
              updatedAt: 1,
            }],
          },
        },
      }),
    ).toEqual({
      eligible: true,
      agentId: 'customAcp',
      strategy: 'vendor_resume',
    });
  });

  it('rejects configured ACP flavor-only and static-disabled sessions', () => {
    expect(evaluateExistingSessionAutomationEligibility({
      metadata: { flavor: 'acp:custom-backend', customAcpSessionId: 'provider-session-1' },
    })).toEqual({ eligible: false, reasonCode: 'agent_unknown' });

    expect(evaluateExistingSessionAutomationEligibility({
      metadata: {
        acpConfiguredBackendV1: {
          v: 1,
          updatedAt: 1,
          backendId: 'custom-backend',
          title: 'Custom backend',
        },
        customAcpSessionId: 'provider-session-1',
      },
      accountSettings: {
        acpCatalogSettingsV1: {
          v: 2,
          backends: [{
            id: 'custom-backend',
            name: 'custom-backend',
            title: 'Custom backend',
            command: 'custom-agent',
            args: [],
            env: {},
            transportProfile: 'generic',
            capabilities: {
              supportsLoadSession: false,
              supportsModes: 'unknown',
              supportsModels: 'unknown',
              supportsConfigOptions: 'unknown',
              promptImageSupport: 'unknown',
            },
            createdAt: 1,
            updatedAt: 1,
          }],
        },
      },
    })).toEqual({ eligible: false, reasonCode: 'agent_unsupported' });
  });

  it('accepts runtime-descriptor sessions without legacy top-level vendor ids', () => {
    expect(
      evaluateExistingSessionAutomationEligibility({
        metadata: {
          agentRuntimeDescriptorV1: {
            v: 1,
            providerId: 'opencode',
            provider: { backendMode: 'server', vendorSessionId: 'opencode-session-1' },
          },
        },
      }),
    ).toEqual({
      eligible: true,
      agentId: 'opencode',
      strategy: 'vendor_resume',
    });
  });
});
