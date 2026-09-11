import { describe, expect, it } from 'vitest';

import { BUILT_IN_ACP_CONFIG, getBuiltInAcpConfig, hasBuiltInAcpConfig } from './acp.js';
import { getProviderCliRuntimeSpec } from './providers/providerCliRuntime.js';
import type { AgentId } from './types.js';

const devinAgentId = 'devin' as AgentId;

describe('built-in ACP config', () => {
  it('keeps the built-in ACP allowlist explicit and drift-free', () => {
    expect(Object.keys(BUILT_IN_ACP_CONFIG).sort()).toEqual(['customAcp', 'devin', 'kiro']);
  });

  it('keeps first-class Grok provider wiring out of the generic ACP catalog', () => {
    expect(hasBuiltInAcpConfig('grok')).toBe(false);
    expect(getBuiltInAcpConfig('grok')).toBeNull();
  });

  it('exposes Custom ACP as a built-in generic ACP agent family', () => {
    expect(hasBuiltInAcpConfig('customAcp')).toBe(true);
    expect(getBuiltInAcpConfig('customAcp')).toMatchObject({
      agentId: 'customAcp',
      launcher: {
        command: getProviderCliRuntimeSpec('customAcp').binaryName,
        args: [],
      },
      transportProfile: 'generic',
      supportsLoadSession: true,
      supportsModes: 'auto',
      supportsModels: 'auto',
      promptImageSupport: 'auto',
    });
  });

  it('exposes Kiro as a built-in generic ACP agent', () => {
    expect(hasBuiltInAcpConfig('kiro')).toBe(true);
    expect(getBuiltInAcpConfig('kiro')).toMatchObject({
      agentId: 'kiro',
      launcher: {
        command: getProviderCliRuntimeSpec('kiro').binaryName,
        args: ['acp'],
      },
      transportProfile: 'kiro',
      supportsLoadSession: true,
      supportsModes: 'yes',
      supportsModels: 'yes',
      promptImageSupport: 'yes',
    });
  });

  it('exposes Devin with its probed ACP contract and provider-default permission behavior', () => {
    expect(hasBuiltInAcpConfig(devinAgentId)).toBe(true);
    expect(getBuiltInAcpConfig(devinAgentId)).toMatchObject({
      agentId: 'devin',
      launcher: {
        command: getProviderCliRuntimeSpec(devinAgentId).binaryName,
        args: ['acp'],
      },
      transportProfile: 'generic',
      supportsLoadSession: true,
      supportsModes: 'yes',
      supportsModels: 'yes',
      promptImageSupport: 'yes',
      mcpServers: 'drop',
      permissionModeMapping: {
        default: null,
        'read-only': 'ask',
        'safe-yolo': 'smart',
        yolo: 'bypass',
        plan: 'plan',
      },
    });
  });

  it('does not mark non-ACP shell-bridge providers as built-in ACP', () => {
    expect(hasBuiltInAcpConfig('gemini')).toBe(false);
    expect(hasBuiltInAcpConfig('pi')).toBe(false);
  });
});
