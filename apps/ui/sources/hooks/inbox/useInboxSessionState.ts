import * as React from 'react';

import {
    useSessionListViewDataByServerId,
} from '@/sync/domains/state/storage';
import { storage } from '@/sync/domains/state/storageStore';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { StorageState } from '@/sync/store/types';
import { createSessionSignatureLedger } from '@/activity/attention/sessionAttentionSignatureLedger';
import { buildStableJsonSignature } from '@/sync/domains/session/metadata/sessionMetadataStability';
import {
    useSessionListRuntimeNowMs,
    useSessionListRuntimeWake,
} from '@/hooks/session/sessionListRuntimeClock';

import {
    buildInboxSessionState,
    resolveNextInboxSessionStateFreshnessAtMs,
    type InboxSessionState,
} from './buildInboxSessionState';

type InboxSessionSources = Readonly<{
    sessions: readonly Session[];
    sessionMessagesById: StorageState['sessionMessages'];
}>;

function readNumber(value: unknown): number | string {
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : '';
}

export function buildInboxSessionSourceSignature(session: Session): string {
    return [
        session.id,
        session.serverId ?? '',
        readNumber(session.archivedAt),
        session.active === true ? 1 : 0,
        readNumber(session.activeAt),
        session.presence,
        session.thinking === true ? 1 : 0,
        readNumber(session.thinkingAt),
        session.latestTurnStatus ?? '',
        readNumber(session.latestTurnStatusObservedAt),
        readNumber(session.latestReadyEventAt),
        readNumber(session.meaningfulActivityAt),
        session.runtimeActivityState ?? '',
        readNumber(session.runtimeActivityActiveCount),
        readNumber(session.runtimeActivityObservedAt),
        readNumber(session.runtimeActivityRevision),
        readNumber(session.seq),
        readNumber(session.latestReadyEventSeq),
        readNumber(session.lastViewedSessionSeq),
        readNumber(session.pendingCount),
        readNumber(session.pendingPermissionRequestCount),
        readNumber(session.pendingUserActionRequestCount),
        readNumber(session.pendingRequestObservedAt),
        readNumber(session.pendingBlockedCount),
        buildStableJsonSignature(session.lastRuntimeIssue),
        session.accessLevel ?? '',
        session.canApprovePermissions === true ? 1 : 0,
        buildStableJsonSignature(session.metadata),
        buildStableJsonSignature(session.agentState),
    ].join('\u001f');
}

function buildInboxSessionMessagesSourceSignature(
    value: StorageState['sessionMessages'][string] | undefined,
): string {
    if (!value) return '';
    return [
        value.isLoaded === true ? 1 : 0,
        readNumber(value.messagesVersion),
        readNumber(value.agentEventSourceVersion),
        readNumber(value.latestReadyEventSeq),
        readNumber(value.latestReadyEventAt),
        value.messageIdsOldestFirst.join('\u001e'),
    ].join('\u001f');
}

function createInboxSessionSourcesSelector(): (state: StorageState) => InboxSessionSources {
    const sessionLedger = createSessionSignatureLedger<Session>(buildInboxSessionSourceSignature);
    const messagesLedger = createSessionSignatureLedger<StorageState['sessionMessages'][string] | undefined>(
        buildInboxSessionMessagesSourceSignature,
    );
    let previousRevision = '';
    let previous: InboxSessionSources = { sessions: [], sessionMessagesById: {} };

    return (state) => {
        const revision = [
            sessionLedger.sync(state.sessions, (id) => state.sessions[id]),
            messagesLedger.sync(state.sessions, (id) => state.sessionMessages[id]),
        ].join(':');
        if (revision === previousRevision) return previous;
        previousRevision = revision;
        previous = {
            sessions: Object.values(state.sessions).sort((left, right) => right.updatedAt - left.updatedAt),
            sessionMessagesById: state.sessionMessages,
        };
        return previous;
    };
}

const selectInboxSessionSources = createInboxSessionSourcesSelector();

/**
 * Canonical mounted Inbox session-state composition.
 *
 * Both the Inbox screen and its navigation badge consume this hook so Home
 * scoping, unread/actionable de-duplication, and time-gated runtime attention
 * can never drift. Freshness wakes are registered with the existing shared
 * session runtime clock, which owns one timer at the earliest requested
 * boundary across every mounted consumer.
 */
export function useInboxSessionState(): InboxSessionState {
    const { sessions, sessionMessagesById } = storage(selectInboxSessionSources);
    const sessionListViewDataByServerId = useSessionListViewDataByServerId();
    const nowMs = useSessionListRuntimeNowMs();

    const nextFreshnessAtMs = React.useMemo(
        () => resolveNextInboxSessionStateFreshnessAtMs({
            sessions,
            sessionListViewDataByServerId,
            sessionMessagesById,
            nowMs,
        }),
        [nowMs, sessionListViewDataByServerId, sessionMessagesById, sessions],
    );
    useSessionListRuntimeWake(nextFreshnessAtMs);

    return React.useMemo(
        () => buildInboxSessionState({
            sessions,
            sessionListViewDataByServerId,
            sessionMessagesById,
            nowMs,
        }),
        [nowMs, sessionListViewDataByServerId, sessionMessagesById, sessions],
    );
}
