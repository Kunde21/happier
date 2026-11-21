import { ConnectedServiceQuotaSnapshotV1Schema, type ConnectedServiceQuotaMeterV1, type ConnectedServiceQuotaSnapshotV1 } from '@happier-dev/protocol';

import { logger } from '@/ui/logger';
import {
  ConnectedServiceQuotaFetchError,
  type ConnectedServiceQuotaFetcher,
  type ConnectedServiceQuotaFetcherDescriptor,
} from '@/daemon/connectedServices/quotas/types';
import { normalizePct } from '@/daemon/connectedServices/quotas/quotaNormalization';
import { parseRetryAfterHeader } from '@/daemon/connectedServices/quotas/normalization';

/**
 * OpenCode Go usage endpoint (ecosystem-observed, undocumented): one Bearer-authenticated read
 * returning percent-used and reset times for the rolling 5-hour, weekly, and monthly allowance
 * windows. Observed in yapcap (src/providers/opencode_go/mod.rs) and documented by
 * pi-opencode-go-usage and opencode-usage-quota-tracker; re-anchor when OpenCode documents it.
 */
export const DEFAULT_OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const OPENCODE_GO_USAGE_URL_ENV = 'HAPPIER_CONNECTED_SERVICES_OPENCODE_GO_USAGE_URL';

export function resolveOpenCodeGoUsageUrl(env: NodeJS.ProcessEnv): string {
  const override = env[OPENCODE_GO_USAGE_URL_ENV]?.trim();
  return override ? override : DEFAULT_OPENCODE_GO_USAGE_URL;
}

type FetchRuntime = typeof fetch;

const GO_USAGE_WINDOWS: ReadonlyArray<Readonly<{
  containerKey: 'rolling' | 'weekly' | 'monthly';
  meterId: string;
  label: string;
  windowDurationMs?: number;
}>> = [
  { containerKey: 'rolling', meterId: 'five_hour', label: '5-hour', windowDurationMs: 18_000_000 },
  { containerKey: 'weekly', meterId: 'seven_day', label: 'Weekly', windowDurationMs: 604_800_000 },
  { containerKey: 'monthly', meterId: 'monthly', label: 'Monthly' },
];

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseResetAtMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.trunc(value);
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function buildWindowMeter(window: Readonly<{
  meterId: string;
  label: string;
  windowDurationMs?: number;
}>, raw: unknown): ConnectedServiceQuotaMeterV1 {
  const record = readRecord(raw);
  const utilizationPct = record !== null ? normalizePct(record.percent) : null;
  return {
    meterId: window.meterId,
    label: window.label,
    ...(window.windowDurationMs !== undefined ? { windowDurationMs: window.windowDurationMs } : {}),
    used: null,
    limit: null,
    unit: 'unknown',
    utilizationPct,
    providerLimitId: window.meterId,
    resetsAt: record !== null ? parseResetAtMs(record.resetsAt) : null,
    status: utilizationPct === null ? 'unavailable' : 'ok',
    details: {},
  };
}

function buildAllUnavailableSnapshot(params: Readonly<{
  profileId: string;
  fetchedAt: number;
  staleAfterMs: number;
}>): ConnectedServiceQuotaSnapshotV1 {
  return ConnectedServiceQuotaSnapshotV1Schema.parse({
    v: 1,
    serviceId: 'opencode-go',
    profileId: params.profileId,
    fetchedAt: Math.max(0, Math.trunc(params.fetchedAt)),
    staleAfterMs: params.staleAfterMs,
    planLabel: null,
    accountLabel: null,
    meters: GO_USAGE_WINDOWS.map((window) => buildWindowMeter(window, null)),
  });
}

export function createOpenCodeGoQuotaFetcher(deps: Readonly<{
  usageUrl?: string;
  staleAfterMs?: number;
  fetchRuntime?: FetchRuntime;
  nowMs?: () => number;
}> = {}): ConnectedServiceQuotaFetcher {
  const usageUrl = deps.usageUrl?.trim() ? deps.usageUrl.trim() : DEFAULT_OPENCODE_GO_USAGE_URL;
  const staleAfterMs = typeof deps.staleAfterMs === 'number' && Number.isFinite(deps.staleAfterMs)
    ? Math.max(1, Math.trunc(deps.staleAfterMs))
    : 300_000;
  const fetchRuntime = deps.fetchRuntime ?? fetch;
  const nowMs = deps.nowMs ?? (() => Date.now());

  async function throwUsageError(response: Response): Promise<never> {
    if (response.status === 401) {
      throw new ConnectedServiceQuotaFetchError(
        'OpenCode Go usage fetch failed (401): reconnect OpenCode Go in Happier and retry.',
        { status: 401, quotaFetchErrorCode: 'auth_failure', reconnectRequired: true },
      );
    }
    if (response.status === 403) {
      throw new ConnectedServiceQuotaFetchError(
        'This OpenCode key has no OpenCode Go subscription on its workspace.',
        { status: 403, quotaFetchErrorCode: 'auth_failure', providerCode: 'no_go_subscription' },
      );
    }
    throw new ConnectedServiceQuotaFetchError(
      `OpenCode Go usage fetch failed (${response.status}): ${response.statusText}`,
      {
        status: response.status,
        quotaFetchErrorCode: 'provider_backoff',
        retryAfterMs: parseRetryAfterHeader(response.headers?.get?.('retry-after'), { nowMs: nowMs() }).retryAfterMs,
      },
    );
  }

  return {
    serviceId: 'opencode-go',
    pollPolicy: {
      minPollIntervalMs: 30 * 60_000,
      retryAfterBackoffMinMs: 15 * 60_000,
    },
    fetch: async ({ record, now, signal }) => {
      if (record.serviceId !== 'opencode-go' || record.kind !== 'token' || !record.token.token) {
        throw new ConnectedServiceQuotaFetchError('missing_opencode_go_token_record', { quotaFetchErrorCode: 'missing_auth' });
      }
      signal.throwIfAborted();

      let response: Response;
      try {
        response = await fetchRuntime(usageUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${record.token.token}`,
            Accept: 'application/json',
          },
          signal,
        });
      } catch (error) {
        if (error instanceof ConnectedServiceQuotaFetchError) throw error;
        throw new ConnectedServiceQuotaFetchError('OpenCode Go usage fetch failed at the network layer.', {
          quotaFetchErrorCode: 'network',
        });
      }

      if (!response.ok) await throwUsageError(response);

      const json: unknown = await response.json().catch(() => null);
      const usage = readRecord(readRecord(json)?.usage);
      if (usage === null) {
        // Tolerant parse for an undocumented endpoint: show unavailable windows, never fake zeros.
        logger.infoFile('[WARN] [OpenCode Go quota] Usage response is unparseable; windows shown as unavailable.');
        return buildAllUnavailableSnapshot({ profileId: record.profileId, fetchedAt: now, staleAfterMs });
      }

      return ConnectedServiceQuotaSnapshotV1Schema.parse({
        v: 1,
        serviceId: 'opencode-go',
        profileId: record.profileId,
        providerId: 'opencode',
        fetchedAt: Math.max(0, Math.trunc(now)),
        staleAfterMs,
        planLabel: null,
        accountLabel: null,
        meters: GO_USAGE_WINDOWS.map((window) => buildWindowMeter(window, usage[window.containerKey])),
      });
    },
  };
}

export const openCodeGoQuotaFetcherDescriptor: ConnectedServiceQuotaFetcherDescriptor = {
  loadQuota: ({ env, staleAfterMs }) => createOpenCodeGoQuotaFetcher({
    usageUrl: resolveOpenCodeGoUsageUrl(env),
    staleAfterMs,
  }),
};
