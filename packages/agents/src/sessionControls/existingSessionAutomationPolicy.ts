import {
  AcpCatalogSettingsV1Schema,
  buildBackendTargetKey,
  readAcpConfiguredBackendV1FromMetadata,
} from '@happier-dev/protocol';
import { resolveAgentIdFromSessionMetadata } from '../resolveAgentIdFromSessionMetadata.js';
import type { AgentId } from '../types.js';
import {
  evaluateVendorResumeEligibility,
  resolveProviderSessionIdForBackendTarget,
  type VendorResumeEligibilityReasonCode,
} from './vendorResumePolicy.js';

export type ExistingSessionAutomationEligibilityReasonCode =
  | VendorResumeEligibilityReasonCode
  | 'agent_unknown';

export type ExistingSessionAutomationEligibility =
  | Readonly<{ eligible: true; agentId: AgentId; strategy: 'vendor_resume' | 'happy_attach' }>
  | Readonly<{ eligible: false; reasonCode: ExistingSessionAutomationEligibilityReasonCode }>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function resolveAgentIdFromMetadata(metadata: Record<string, unknown>): AgentId | null {
  const agentId = resolveAgentIdFromSessionMetadata(metadata);
  return agentId && agentId !== 'customAcp' ? agentId : null;
}

export function evaluateExistingSessionAutomationEligibility(input: Readonly<{
  metadata: unknown;
  accountSettings?: Record<string, unknown> | null;
}>): ExistingSessionAutomationEligibility {
  const metadata = asRecord(input.metadata);
  if (!metadata) {
    return { eligible: false, reasonCode: 'agent_unknown' };
  }

  const configuredBackend = readAcpConfiguredBackendV1FromMetadata(metadata);
  if (configuredBackend) {
    const settings = asRecord(input.accountSettings);
    const catalog = AcpCatalogSettingsV1Schema.safeParse(settings?.acpCatalogSettingsV1);
    const declaredBackend = catalog.success
      ? catalog.data.backends.find((backend) => backend.id === configuredBackend.backendId)
      : undefined;
    const target = { kind: 'configuredAcpBackend' as const, backendId: configuredBackend.backendId };
    const enabledByTargetKey = asRecord(settings?.backendEnabledByTargetKey);
    if (!declaredBackend?.capabilities.supportsLoadSession || enabledByTargetKey?.[buildBackendTargetKey(target)] === false) {
      return { eligible: false, reasonCode: 'agent_unsupported' };
    }
    if (!resolveProviderSessionIdForBackendTarget(target, metadata)) {
      return { eligible: false, reasonCode: 'vendor_resume_id_missing' };
    }
    return {
      eligible: true,
      agentId: 'customAcp',
      strategy: 'vendor_resume',
    };
  }

  const agentId = resolveAgentIdFromMetadata(metadata);
  if (!agentId) {
    return { eligible: false, reasonCode: 'agent_unknown' };
  }

  const eligibility = evaluateVendorResumeEligibility({
    agentId,
    metadata,
    accountSettings: input.accountSettings ?? null,
  });
  if (!eligibility.eligible) {
    return eligibility;
  }

  return {
    eligible: true,
    agentId,
    strategy: 'vendor_resume',
  };
}
