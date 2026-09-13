import { describe, expect, it } from 'vitest';

import { t } from '@/text';

import {
    buildSessionDraftSyncStatusBadge,
    resolveSessionDraftStatusKey,
} from './sessionDraftStatusPresentation';

describe('sessionDraftStatusPresentation', () => {
    it.each([
        ['pending', 'sessionDrafts.status.syncing', 'active'],
        ['offline', 'sessionDrafts.status.offline', 'paused'],
        ['error', 'common.error', 'danger'],
    ] as const)('projects %s from the repository status into the composer badge', (status, labelKey, tone) => {
        const label = t(labelKey);
        expect(buildSessionDraftSyncStatusBadge(status)).toEqual(expect.objectContaining({
            key: 'draft-sync-status',
            label,
            accessibilityLabel: label,
            testID: 'session-draft-sync-status-badge',
            tone,
        }));
    });

    it('leaves clean and interactive conflict states to their existing owners', () => {
        expect(buildSessionDraftSyncStatusBadge('clean')).toBeNull();
        expect(buildSessionDraftSyncStatusBadge('conflict')).toBeNull();
        expect(resolveSessionDraftStatusKey('conflict')).toBe('sessionDrafts.status.conflict');
    });
});
