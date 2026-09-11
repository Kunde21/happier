import { describe, expect, it } from 'vitest';

import type { ConnectedServiceQuotaSnapshotV1 } from '@happier-dev/protocol';

import { buildPoolQuotaLimitCandidates } from './PoolQuotaLimitsSelectField';

function snapshot(meters: ConnectedServiceQuotaSnapshotV1['meters']): ConnectedServiceQuotaSnapshotV1 {
    return {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'work',
        fetchedAt: 1,
        staleAfterMs: 1,
        planLabel: null,
        accountLabel: null,
        meters,
    };
}

describe('buildPoolQuotaLimitCandidates', () => {
    it('groups windows under the provider allowance and uses the provider label', () => {
        const candidates = buildPoolQuotaLimitCandidates({
            snapshots: [snapshot([
                { meterId: 'spark:primary', providerLimitId: 'spark', label: 'Spark · Primary', used: null, limit: null, unit: 'unknown', utilizationPct: 5, resetsAt: null, status: 'ok', details: {} },
                { meterId: 'spark:secondary', providerLimitId: 'spark', label: 'Spark · Secondary', used: null, limit: null, unit: 'unknown', utilizationPct: 10, resetsAt: null, status: 'ok', details: {} },
            ])],
        });
        expect(candidates).toEqual([{ id: 'spark', title: 'Spark' }]);
    });

    it('keeps selected limits visible when no current account reports them', () => {
        const candidates = buildPoolQuotaLimitCandidates({
            snapshots: [],
            selection: { mode: 'selected', providerLimitIds: ['retired-limit'] },
        });
        expect(candidates).toEqual([expect.objectContaining({ id: 'retired-limit', title: 'retired-limit', subtitle: expect.any(String) })]);
    });
});
