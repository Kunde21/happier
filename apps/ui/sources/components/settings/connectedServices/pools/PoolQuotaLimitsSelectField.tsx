import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { t } from '@/text';
import type {
    ConnectedServiceAuthGroupQuotaLimitSelectionV1,
    ConnectedServiceQuotaSnapshotV1,
} from '@happier-dev/protocol';

import { PoolMultiSelectField, type PoolMultiSelectCandidate } from './PoolMultiSelectField';

export type PoolQuotaLimitCandidate = PoolMultiSelectCandidate;
// A whitespace-only value cannot collide with a provider limit id: the wire schema
// trims and rejects it. It remains local to this menu and is never persisted.
const ALL_QUOTA_LIMITS_OPTION_ID = ' ';

export function buildPoolQuotaLimitCandidates(input: Readonly<{
    snapshots: ReadonlyArray<ConnectedServiceQuotaSnapshotV1 | null>;
    selection?: ConnectedServiceAuthGroupQuotaLimitSelectionV1;
}>): ReadonlyArray<PoolQuotaLimitCandidate> {
    const byId = new Map<string, { title: string; reported: boolean }>();
    for (const snapshot of input.snapshots) {
        for (const meter of snapshot?.meters ?? []) {
            const id = meter.providerLimitId?.trim() || meter.meterId.trim();
            if (!id) continue;
            const existing = byId.get(id);
            const meterTitle = meter.label.split(' · ')[0]?.trim() || id;
            const scopedLabel = meterTitle.match(/\(([^)]+)\)$/)?.[1]?.trim() || null;
            const entry = existing ?? { title: scopedLabel ?? meterTitle ?? meter.modelId?.trim() ?? id, reported: true };
            byId.set(id, entry);
        }
    }
    if (input.selection?.mode === 'selected') {
        for (const id of input.selection.providerLimitIds) {
            if (!byId.has(id)) byId.set(id, { title: id, reported: false });
        }
    }
    return Array.from(byId, ([id, entry]) => ({
        id,
        title: entry.title,
        ...(!entry.reported ? { subtitle: t('connectedServices.pools.detail.quotaLimitNotReported') } : {}),
    })).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export const PoolQuotaLimitsSelectField = React.memo(function PoolQuotaLimitsSelectField(props: Readonly<{
    snapshots: ReadonlyArray<ConnectedServiceQuotaSnapshotV1 | null>;
    selection?: ConnectedServiceAuthGroupQuotaLimitSelectionV1;
    onChange: (selection: ConnectedServiceAuthGroupQuotaLimitSelectionV1) => void;
    disabled?: boolean;
}>) {
    const { theme } = useUnistyles();
    const candidates = React.useMemo(
        () => buildPoolQuotaLimitCandidates({ snapshots: props.snapshots, selection: props.selection }),
        [props.selection, props.snapshots],
    );
    const selectedIds = props.selection?.mode === 'selected'
        ? props.selection.providerLimitIds
        : [ALL_QUOTA_LIMITS_OPTION_ID];
    const menuCandidates = React.useMemo(() => [{
        id: ALL_QUOTA_LIMITS_OPTION_ID,
        title: t('connectedServices.pools.detail.quotaLimitsAll'),
    }, ...candidates], [candidates]);
    return (
        <PoolMultiSelectField
            testID="connected-services-pool-detail:quota-limits"
            candidates={menuCandidates}
            selectedIds={selectedIds}
            onCommit={(ids) => {
                props.onChange(ids.includes(ALL_QUOTA_LIMITS_OPTION_ID)
                    ? { mode: 'all', providerLimitIds: [] }
                    : { mode: 'selected', providerLimitIds: ids.filter((id) => id !== ALL_QUOTA_LIMITS_OPTION_ID) });
            }}
            title={t('connectedServices.pools.detail.quotaLimitsTitle')}
            subtitle={() => props.selection?.mode === 'selected'
                ? t('connectedServices.pools.detail.quotaLimitsSelected', { count: props.selection.providerLimitIds.length })
                : t('connectedServices.pools.detail.quotaLimitsAll')}
            emptySubtitle={t('connectedServices.pools.detail.quotaLimitsUnavailable')}
            searchPlaceholder={t('connectedServices.pools.detail.quotaLimitsSearch')}
            optionTestIDPrefix="connected-services-pool-detail:quota-limits:option"
            icon={<Icon name="chart-line" size={20} color={theme.colors.accent.blue} />}
            disabled={props.disabled}
            minimumSelected={1}
            exclusiveId={ALL_QUOTA_LIMITS_OPTION_ID}
        />
    );
});
