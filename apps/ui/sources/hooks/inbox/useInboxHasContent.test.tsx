import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import {
    InboxContentModelProvider,
    type InboxContentModel,
} from '@/components/inbox/useInboxContentModel';

import { useInboxHasContent } from './useInboxHasContent';

vi.mock('@/sync/domains/state/storage', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/state/storage')>(),
    useActiveServerAccountScope: () => ({ accountId: 'account-1' }),
    useArtifacts: () => [],
}));

vi.mock('@/sync/domains/actionOperations/useActionOperations', () => ({
    useActionOperationsNeedAttention: () => false,
}));

vi.mock('./useInboxFriendRequests', () => ({
    useInboxFriendRequests: () => ({ visible: false, requests: [] }),
}));

vi.mock('./useInboxSessionState', () => ({
    useInboxSessionState: () => ({
        reviewSessions: [],
        sessionsNeedingAttention: [],
    }),
}));

function InboxContentProbe(props: Readonly<{ onValue: (value: boolean) => void }>) {
    props.onValue(useInboxHasContent());
    return null;
}

describe('useInboxHasContent', () => {
    it('reads the already-mounted Inbox projection instead of mounting parallel subscriptions', async () => {
        const values: boolean[] = [];
        const model = { hasContent: true } as InboxContentModel;

        await renderScreen(
            <InboxContentModelProvider model={model}>
                <InboxContentProbe onValue={(value) => values.push(value)} />
            </InboxContentModelProvider>,
        );

        expect(values.at(-1)).toBe(true);
    });
});
