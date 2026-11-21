import { describe, expect, it } from 'vitest';
import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';

import { createOpenCodeGoQuotaFetcher, openCodeGoQuotaFetcherDescriptor, resolveOpenCodeGoUsageUrl } from './quotaFetcher';

function goTokenRecord() {
  return buildConnectedServiceCredentialRecord({
    now: 1000,
    serviceId: 'opencode-go',
    profileId: 'go-work',
    kind: 'token',
    token: { token: 'oc_sk_test-profile-key', providerAccountId: null, providerEmail: null },
  });
}

const USAGE_BODY = {
  usage: {
    rolling: { status: 'ok', percent: 62.5, resetsAt: '2026-11-21T12:00:00Z' },
    weekly: { status: 'ok', percent: 31, resetsAt: '2026-11-23T00:00:00Z' },
    monthly: { status: 'ok', percent: 44, resetsAt: '2026-12-01T00:00:00Z' },
  },
};

describe('OpenCode Go quota fetcher', () => {
  it('maps the usage endpoint response to five-hour, weekly, and monthly meters', async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const fetcher = createOpenCodeGoQuotaFetcher({
      staleAfterMs: 123_000,
      fetchRuntime: async (url, init) => {
        requests.push({ url: String(url), headers: new Headers(init?.headers) });
        return Response.json(USAGE_BODY);
      },
    });

    const snapshot = await fetcher.fetch({ record: goTokenRecord(), now: 2000, signal: new AbortController().signal });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://opencode.ai/zen/go/v1/usage');
    expect(requests[0].headers.get('authorization')).toBe('Bearer oc_sk_test-profile-key');
    expect(snapshot).toMatchObject({
      v: 1,
      serviceId: 'opencode-go',
      profileId: 'go-work',
      staleAfterMs: 123_000,
      meters: [
        { meterId: 'five_hour', label: '5-hour', utilizationPct: 62.5, windowDurationMs: 18_000_000, status: 'ok', resetsAt: Date.parse('2026-11-21T12:00:00Z') },
        { meterId: 'seven_day', label: 'Weekly', utilizationPct: 31, windowDurationMs: 604_800_000, status: 'ok', resetsAt: Date.parse('2026-11-23T00:00:00Z') },
        { meterId: 'monthly', label: 'Monthly', utilizationPct: 44, status: 'ok', resetsAt: Date.parse('2026-12-01T00:00:00Z') },
      ],
    });
    for (const meter of snapshot!.meters) {
      expect(meter.used).toBeNull();
      expect(meter.limit).toBeNull();
    }
  });

  it('marks missing or non-finite windows unavailable instead of fabricating values', async () => {
    const fetcher = createOpenCodeGoQuotaFetcher({
      fetchRuntime: async () => Response.json({
        usage: {
          rolling: { status: 'ok', percent: 10, resetsAt: '2026-11-21T12:00:00Z' },
          weekly: { status: 'unknown' },
          monthly: { status: 'ok', percent: 'not-a-number', resetsAt: null },
        },
      }),
    });

    const snapshot = await fetcher.fetch({ record: goTokenRecord(), now: 2000, signal: new AbortController().signal });

    expect(snapshot?.meters.map((meter) => [meter.meterId, meter.status, meter.utilizationPct])).toEqual([
      ['five_hour', 'ok', 10],
      ['seven_day', 'unavailable', null],
      ['monthly', 'unavailable', null],
    ]);
  });

  it('returns all-unavailable meters for an unparseable body rather than a fake zero snapshot', async () => {
    const fetcher = createOpenCodeGoQuotaFetcher({
      fetchRuntime: async () => new Response('<html>gateway</html>', { status: 200 }),
    });

    const snapshot = await fetcher.fetch({ record: goTokenRecord(), now: 2000, signal: new AbortController().signal });

    expect(snapshot?.meters).toHaveLength(3);
    expect(snapshot?.meters.every((meter) => meter.status === 'unavailable' && meter.utilizationPct === null)).toBe(true);
  });

  it('surfaces 401 as a reconnect-required auth failure without leaking the key', async () => {
    const fetcher = createOpenCodeGoQuotaFetcher({ fetchRuntime: async () => Response.json({ error: 'unauthorized' }, { status: 401 }) });
    const promise = fetcher.fetch({ record: goTokenRecord(), now: 2000, signal: new AbortController().signal });
    await expect(promise).rejects.toMatchObject({ quotaFetchErrorCode: 'auth_failure', status: 401, reconnectRequired: true });
    await promise.catch((error: Error) => {
      expect(error.message).not.toContain('oc_sk_test-profile-key');
    });
  });

  it('surfaces 403 as the no-subscription state and 429 as provider backoff with Retry-After', async () => {
    const noSubscription = createOpenCodeGoQuotaFetcher({
      fetchRuntime: async () => Response.json({ error: 'forbidden' }, { status: 403 }),
    });
    await expect(
      noSubscription.fetch({ record: goTokenRecord(), now: 2000, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ quotaFetchErrorCode: 'auth_failure', status: 403, providerCode: 'no_go_subscription' });

    const limited = createOpenCodeGoQuotaFetcher({
      fetchRuntime: async () => new Response('rate limited', { status: 429, headers: { 'retry-after': '120' } }),
    });
    await expect(
      limited.fetch({ record: goTokenRecord(), now: 2000, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ quotaFetchErrorCode: 'provider_backoff', status: 429, retryAfterMs: 120_000 });
  });

  it('rejects non-token credential records before any network call', async () => {
    const calls: string[] = [];
    const fetcher = createOpenCodeGoQuotaFetcher({
      fetchRuntime: async (url) => {
        calls.push(String(url));
        return Response.json(USAGE_BODY);
      },
    });
    const record = buildConnectedServiceCredentialRecord({
      now: 1000,
      serviceId: 'opencode-go',
      profileId: 'go-work',
      kind: 'oauth',
      oauth: { accessToken: 'access', refreshToken: 'refresh', idToken: null, scope: null, tokenType: null, providerAccountId: null, providerEmail: null },
    });

    await expect(fetcher.fetch({ record, now: 2000, signal: new AbortController().signal }))
      .rejects.toMatchObject({ quotaFetchErrorCode: 'missing_auth' });
    expect(calls).toHaveLength(0);
  });

  it('exposes the descriptor with a conservative poll floor and an env-overridable usage URL', () => {
    const fetcher = openCodeGoQuotaFetcherDescriptor.loadQuota!({ env: {}, staleAfterMs: 300_000 });

    expect(fetcher.serviceId).toBe('opencode-go');
    expect(fetcher.pollPolicy?.minPollIntervalMs).toBeGreaterThanOrEqual(30 * 60_000);
    expect(resolveOpenCodeGoUsageUrl({})).toBe('https://opencode.ai/zen/go/v1/usage');
    expect(resolveOpenCodeGoUsageUrl({ HAPPIER_CONNECTED_SERVICES_OPENCODE_GO_USAGE_URL: 'https://usage.example/go' }))
      .toBe('https://usage.example/go');
  });
});
