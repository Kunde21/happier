import type { AgentId, PermissionMode } from './types.js';
import { getProviderCliRuntimeSpec } from './providers/providerCliRuntime.js';

export type BuiltInAcpTransportProfile = 'generic' | 'kiro';
export type BuiltInAcpYesNoAuto = 'yes' | 'no' | 'auto';

export type BuiltInAcpConfig = Readonly<{
  agentId: AgentId;
  launcher: Readonly<{
    command: string;
    args: ReadonlyArray<string>;
  }>;
  transportProfile: BuiltInAcpTransportProfile;
  supportsLoadSession: boolean;
  supportsModes: BuiltInAcpYesNoAuto;
  supportsModels: BuiltInAcpYesNoAuto;
  promptImageSupport: BuiltInAcpYesNoAuto;
  /** Whether Happier's MCP server list is passed to the ACP session/new request. */
  mcpServers?: 'pass' | 'drop';
  /** Provider ACP mode selected for each explicit Happier permission intent. Null means no override. */
  permissionModeMapping?: Readonly<Partial<Record<PermissionMode, string | null>>>;
}>;

function providerLauncherCommand(agentId: AgentId): string {
  return getProviderCliRuntimeSpec(agentId).binaryName;
}

export const BUILT_IN_ACP_CONFIG: Readonly<Partial<Record<AgentId, BuiltInAcpConfig>>> = Object.freeze({
  customAcp: {
    agentId: 'customAcp',
    launcher: {
      command: providerLauncherCommand('customAcp'),
      args: [],
    },
    transportProfile: 'generic',
    supportsLoadSession: true,
    supportsModes: 'auto',
    supportsModels: 'auto',
    promptImageSupport: 'auto',
  },
  kiro: {
    agentId: 'kiro',
    launcher: {
      command: providerLauncherCommand('kiro'),
      args: ['acp'],
    },
    transportProfile: 'kiro',
    supportsLoadSession: true,
    supportsModes: 'yes',
    supportsModels: 'yes',
    promptImageSupport: 'yes',
  },
  devin: {
    agentId: 'devin',
    launcher: {
      command: providerLauncherCommand('devin'),
      args: ['acp'],
    },
    transportProfile: 'generic',
    supportsLoadSession: true,
    supportsModes: 'yes',
    supportsModels: 'yes',
    promptImageSupport: 'yes',
    // Devin 3000.10.21 ignores standard ACP MCP descriptors; the CLI adapter materializes its native config instead.
    mcpServers: 'drop',
    permissionModeMapping: {
      // Preserve the user's configured Devin permission mode unless Happier explicitly overrides it.
      default: null,
      'read-only': 'ask',
      'safe-yolo': 'smart',
      yolo: 'bypass',
      plan: 'plan',
    },
  },
});

export function hasBuiltInAcpConfig(agentId: AgentId): boolean {
  return BUILT_IN_ACP_CONFIG[agentId] != null;
}

export function getBuiltInAcpConfig(agentId: AgentId): BuiltInAcpConfig | null {
  return BUILT_IN_ACP_CONFIG[agentId] ?? null;
}
