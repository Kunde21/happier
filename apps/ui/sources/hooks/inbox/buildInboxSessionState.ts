import type { Session } from '@/sync/domains/state/storageTypes';
import { listPendingPermissionRequests, listPendingUserActionRequests, type PendingPermissionRequest } from '@/utils/sessions/sessionUtils';
import {
    buildSessionListRenderableFromSession,
    type SessionListRenderableSession,
} from '@/sync/domains/session/listing/sessionListRenderable';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';
import {
    resolveNextSessionRuntimePresentationFreshnessAtMs,
    type DeriveSessionRuntimePresentationStateInput,
} from '@/sync/domains/session/attention/deriveSessionRuntimePresentationState';
import { readStoredSessionMessagesFromStateLike } from '@/sync/domains/messages/readStoredSessionMessages';
import type { StorageState } from '@/sync/store/types';
import type { SessionBulkActionTarget } from '@/components/sessions/actions/sessionBulkActionTypes';
import { normalizeSessionListKeyParts } from '@/sync/domains/session/listing/sessionListKeyNormalization';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import {
    projectSessionListPlacement,
    type SessionListPlacementKind,
} from '@/sync/domains/session/listing/placement/sessionListPlacementProjection';

export type InboxActionRequiredReason = Extract<
    SessionListPlacementKind,
    'action_required' | 'permission_required'
>;

export type InboxReviewReason = Extract<SessionListPlacementKind, 'ready' | 'failed'>;

export type InboxSessionAttentionEntry = Readonly<{
    key: string;
    serverId: string | null;
    sessionId: string;
    session: InboxAttentionSession;
    reason: InboxActionRequiredReason;
    pendingPermissions: readonly PendingPermissionRequest[];
    pendingUserActions: readonly PendingPermissionRequest[];
}>;

export type InboxAttentionSession = Session | SessionListRenderableSession;
export type InboxReviewSessionEntry = Readonly<{
    key: string;
    serverId: string | null;
    sessionId: string;
    session: InboxAttentionSession;
    reason: InboxReviewReason;
}>;

export type InboxSessionState = Readonly<{
    reviewSessions: InboxReviewSessionEntry[];
    sessionsNeedingAttention: InboxSessionAttentionEntry[];
    markAllReadTargets: SessionBulkActionTarget[];
    sessionByKey: ReadonlyMap<string, Readonly<{
        serverId: string | null;
        sessionId: string;
        session: InboxAttentionSession;
    }>>;
}>;

type BuildInboxSessionStateInput =
    | readonly Session[]
    | Readonly<{
        sessions: readonly Session[];
        sessionListViewDataByServerId?: Readonly<Record<string, readonly SessionListViewItem[] | null>>;
        sessionMessagesById?: StorageState['sessionMessages'];
        nowMs?: number;
    }>;

function normalizeBuildInboxSessionStateInput(input: BuildInboxSessionStateInput): Readonly<{
    sessions: readonly Session[];
    sessionListViewDataByServerId: Readonly<Record<string, readonly SessionListViewItem[] | null>>;
    sessionMessagesById?: StorageState['sessionMessages'];
    nowMs: number;
}> {
    if ('sessions' in input) {
        return {
            sessions: input.sessions,
            sessionListViewDataByServerId: input.sessionListViewDataByServerId ?? {},
            sessionMessagesById: input.sessionMessagesById,
            nowMs: typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) ? input.nowMs : Date.now(),
        };
    }
    return { sessions: input, sessionListViewDataByServerId: {}, nowMs: Date.now() };
}

type InboxSessionAddress = Readonly<{
    key: string;
    serverId: string | null;
    sessionId: string;
}>;

function buildInboxSessionAddress(serverIdRaw: unknown, sessionIdRaw: unknown): InboxSessionAddress | null {
    const parts = normalizeSessionListKeyParts(serverIdRaw, sessionIdRaw);
    if (!parts.sessionId) return null;
    return {
        key: parts.sessionKey ?? parts.sessionId,
        serverId: parts.serverId || null,
        sessionId: parts.sessionId,
    };
}

function findScopedSession(
    sessions: readonly Session[],
    address: InboxSessionAddress,
): Session | null {
    if (!address.serverId) return null;
    return sessions.find((session) => (
        session.id === address.sessionId
        && Boolean(session.serverId)
        && areServerProfileIdentifiersEquivalent(session.serverId, address.serverId)
    )) ?? null;
}

function collectInboxSessionEntries(params: Readonly<{
    sessions: readonly Session[];
    sessionListViewDataByServerId: Readonly<Record<string, readonly SessionListViewItem[] | null>>;
}>): Array<Readonly<{
    key: string;
    serverId: string | null;
    sessionId: string;
    session: InboxAttentionSession;
}>> {
    const entries: Array<Readonly<{
        key: string;
        serverId: string | null;
        sessionId: string;
        session: InboxAttentionSession;
    }>> = [];
    const seenKeys = new Set<string>();
    const scopedCacheSessionIds = new Set<string>();
    const matchedHydratedSessions = new Set<Session>();

    for (const [recordServerId, items] of Object.entries(params.sessionListViewDataByServerId)) {
        const serverParts = normalizeSessionListKeyParts(recordServerId);
        if (!serverParts.serverId || !items) continue;
        for (const item of items) {
            if (item.type !== 'session') continue;
            const address = buildInboxSessionAddress(serverParts.serverId, item.session.id);
            if (!address || seenKeys.has(address.key)) continue;
            seenKeys.add(address.key);
            scopedCacheSessionIds.add(address.sessionId);
            const canonicalSession = findScopedSession(params.sessions, address);
            if (canonicalSession) matchedHydratedSessions.add(canonicalSession);
            if (item.session.archivedAt != null || canonicalSession?.archivedAt != null) continue;
            entries.push({ ...address, session: canonicalSession ?? item.session });
        }
    }

    for (const session of params.sessions) {
        if (matchedHydratedSessions.has(session)) continue;
        const address = buildInboxSessionAddress(session.serverId, session.id);
        if (!address || seenKeys.has(address.key)) continue;
        // A server-qualified list row is the only safe source of Home identity.
        // Do not append a bare-id hydrated fallback beside it: the global hydrated
        // map may currently belong to a different Home after a background commit.
        if (!address.serverId && scopedCacheSessionIds.has(address.sessionId)) continue;
        seenKeys.add(address.key);
        if (session.archivedAt != null) continue;
        entries.push({ ...address, session });
    }

    return entries;
}

function readMessagesForInboxSession(
    sessionMessagesById: StorageState['sessionMessages'] | undefined,
    sessionId: string,
) {
    if (!sessionMessagesById) return undefined;
    return readStoredSessionMessagesFromStateLike(sessionMessagesById[sessionId]);
}

function buildPendingInboxRuntimeInput(params: Readonly<{
    session: InboxAttentionSession;
    pendingPermissions: readonly PendingPermissionRequest[];
    pendingUserActions: readonly PendingPermissionRequest[];
}>): DeriveSessionRuntimePresentationStateInput {
    const projectedPendingPermissions = 'agentState' in params.session
        ? params.pendingPermissions.length > 0
        : params.session.hasPendingPermissionRequests === true;
    const projectedPendingUserActions = 'agentState' in params.session
        ? params.pendingUserActions.length > 0
        : params.session.hasPendingUserActionRequests === true;
    return {
        active: params.session.active,
        activeAt: params.session.activeAt,
        archivedAt: params.session.archivedAt,
        presence: params.session.presence,
        thinking: params.session.thinking,
        thinkingAt: params.session.thinkingAt,
        latestTurnStatus: params.session.latestTurnStatus,
        latestTurnStatusObservedAt: params.session.latestTurnStatusObservedAt,
        latestReadyEventAt: params.session.latestReadyEventAt,
        runtimeActivityState: params.session.runtimeActivityState,
        runtimeActivityActiveCount: params.session.runtimeActivityActiveCount,
        runtimeActivityObservedAt: params.session.runtimeActivityObservedAt,
        runtimeActivityRevision: params.session.runtimeActivityRevision,
        meaningfulActivityAt: params.session.meaningfulActivityAt,
        hasPendingPermissionRequests: projectedPendingPermissions,
        hasPendingUserActionRequests: projectedPendingUserActions,
        pendingRequestObservedAt: 'agentState' in params.session
            ? latestPendingRequestObservedAt([
                ...params.pendingPermissions,
                ...params.pendingUserActions,
            ])
            : params.session.pendingRequestObservedAt ?? null,
    };
}

function latestPendingRequestObservedAt(requests: readonly PendingPermissionRequest[]): number | null {
    let latest: number | null = null;
    for (const request of requests) {
        const createdAt = request.createdAt;
        if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt <= 0) continue;
        latest = latest === null ? createdAt : Math.max(latest, createdAt);
    }
    return latest;
}

export function buildInboxSessionState(input: BuildInboxSessionStateInput): InboxSessionState {
    const { sessions, sessionListViewDataByServerId, sessionMessagesById, nowMs } = normalizeBuildInboxSessionStateInput(input);
    const sessionsNeedingAttention: InboxSessionAttentionEntry[] = [];
    const candidates = collectInboxSessionEntries({ sessions, sessionListViewDataByServerId });
    const sessionByKey = new Map(candidates.map((entry) => [entry.key, {
        serverId: entry.serverId,
        sessionId: entry.sessionId,
        session: entry.session,
    }] as const));

    const reviewSessions: InboxReviewSessionEntry[] = [];
    const markAllReadTargets: SessionBulkActionTarget[] = [];
    for (const entry of candidates) {
        if (!isUserFacingSession(entry.session)) continue;
        const isHydrated = 'agentState' in entry.session;
        const messages = isHydrated
            ? readMessagesForInboxSession(sessionMessagesById, entry.sessionId)
            : undefined;
        const pendingPermissions = isHydrated
            ? listPendingPermissionRequests(entry.session, messages)
            : [];
        const pendingUserActions = isHydrated
            ? listPendingUserActionRequests(entry.session, messages)
            : [];
        const renderable = 'agentState' in entry.session
            ? buildSessionListRenderableFromSession(entry.session, messages)
            : entry.session;
        const placement = projectSessionListPlacement({
            session: renderable,
            sessionKey: entry.key,
            nowMs,
        });

        if (placement.kind === 'permission_required' || placement.kind === 'action_required') {
            sessionsNeedingAttention.push({
                key: entry.key,
                serverId: entry.serverId,
                sessionId: entry.sessionId,
                session: entry.session,
                reason: placement.kind,
                pendingPermissions,
                pendingUserActions,
            });
            continue;
        }

        // Inbox is the review/action surface, not a second unread feed. The session
        // list projection already owns precedence between working, completion,
        // failure and raw unread state. Only terminal review placements belong here;
        // plain unread and working remain in the session list until a turn completes.
        if (placement.kind !== 'ready' && placement.kind !== 'failed') continue;
        reviewSessions.push({ ...entry, reason: placement.kind });
        if (placement.kind === 'ready' && renderable.hasUnreadMessages === true) {
            markAllReadTargets.push({
                key: entry.key,
                sessionId: entry.sessionId,
                serverId: entry.serverId,
                readState: 'unread',
            });
        }
    }

    return {
        reviewSessions,
        sessionsNeedingAttention,
        markAllReadTargets,
        sessionByKey,
    };
}

export function hasInboxSessionContent(input: BuildInboxSessionStateInput): boolean {
    const state = buildInboxSessionState(input);
    return state.sessionsNeedingAttention.length > 0 || state.reviewSessions.length > 0;
}

export function resolveNextInboxSessionStateFreshnessAtMs(input: Readonly<{
    sessions: readonly Session[];
    sessionListViewDataByServerId?: Readonly<Record<string, readonly SessionListViewItem[] | null>>;
    sessionMessagesById?: StorageState['sessionMessages'];
    nowMs: number;
}>): number | null {
    let nextAtMs: number | null = null;
    const candidates = collectInboxSessionEntries({
        sessions: input.sessions,
        sessionListViewDataByServerId: input.sessionListViewDataByServerId ?? {},
    });
    for (const { session } of candidates) {
        if (session.archivedAt != null) continue;
        if (!isUserFacingSession(session)) continue;
        const isHydrated = 'agentState' in session;
        const messages = isHydrated
            ? readMessagesForInboxSession(input.sessionMessagesById, session.id)
            : undefined;
        const pendingPermissions = isHydrated ? listPendingPermissionRequests(session, messages) : [];
        const pendingUserActions = isHydrated ? listPendingUserActionRequests(session, messages) : [];
        const runtimeInput = buildPendingInboxRuntimeInput({ session, pendingPermissions, pendingUserActions });
        const freshnessAtMs = resolveNextSessionRuntimePresentationFreshnessAtMs(
            runtimeInput,
            input.nowMs,
        );
        if (freshnessAtMs === null) continue;
        nextAtMs = nextAtMs === null ? freshnessAtMs : Math.min(nextAtMs, freshnessAtMs);
    }
    return nextAtMs;
}
