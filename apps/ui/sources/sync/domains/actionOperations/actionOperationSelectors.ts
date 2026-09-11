import type { ActionOperationSnapshotV1, ActionOperationStateV1 } from '@happier-dev/protocol';

import {
    actionOperationScopeKey,
    type ActionOperationObservation,
    type ActionOperationScope,
    type ActionOperationStoreState,
} from './actionOperationStore';

type ActionOperationSelectorScope = ActionOperationScope & Readonly<{
    sessionId?: string;
    states?: readonly ActionOperationStateV1[];
}>;

export type InboxActionOperationReason = 'failed' | 'status_unavailable' | 'setup_needs_attention';

export type InboxActionOperationEntry = Readonly<{
    operation: ActionOperationSnapshotV1;
    reason: InboxActionOperationReason;
}>;

function sameReferences(
    previous: readonly ActionOperationSnapshotV1[],
    next: readonly ActionOperationSnapshotV1[],
): boolean {
    return previous.length === next.length && previous.every((item, index) => item === next[index]);
}

export function createActionOperationSelector(scope: ActionOperationSelectorScope) {
    const states = scope.states ? new Set(scope.states) : null;
    let previous: readonly ActionOperationSnapshotV1[] = [];

    return (state: ActionOperationStoreState): readonly ActionOperationSnapshotV1[] => {
        const next = Array.from(state.operationsById.values()).filter((operation) => (
            operation.scope.accountId === scope.accountId
            && operation.scope.machineId === scope.machineId
            && !state.dismissedOperationIds.has(operation.operationId)
            && (scope.sessionId === undefined || operation.scope.sessionId === scope.sessionId)
            && (states === null || states.has(operation.state))
        ));
        if (sameReferences(previous, next)) return previous;
        previous = next;
        return previous;
    };
}

export function selectActionOperationObservation(
    state: ActionOperationStoreState,
    scope: ActionOperationScope,
): ActionOperationObservation {
    return state.observationByScope.get(actionOperationScopeKey(scope)) ?? 'available';
}

export function selectActionOperationObservationForOperation(
    state: ActionOperationStoreState,
    operation: ActionOperationSnapshotV1,
): ActionOperationObservation {
    const scopeObservation = selectActionOperationObservation(state, operation.scope);
    if (scopeObservation !== 'available') return scopeObservation;
    return state.unavailableOperationIds.has(operation.operationId) ? 'status_unavailable' : 'available';
}

function sameInboxEntries(
    previous: readonly InboxActionOperationEntry[],
    next: readonly InboxActionOperationEntry[],
): boolean {
    return previous.length === next.length && previous.every((entry, index) => (
        entry.operation === next[index]?.operation && entry.reason === next[index]?.reason
    ));
}

/**
 * Projects only operation states that require an Inbox response. Routine lifecycle
 * activity remains available through the unfiltered Activity selectors.
 */
export function createInboxActionOperationEntriesSelector(
    accountId: string,
    resolveLocalPresentation: (
        operation: ActionOperationSnapshotV1,
    ) => Readonly<{ kind: 'setup_needs_attention' }> | null = () => null,
) {
    let previous: readonly InboxActionOperationEntry[] = [];
    return (state: ActionOperationStoreState): readonly InboxActionOperationEntry[] => {
        const next: InboxActionOperationEntry[] = [];
        for (const operation of state.operationsById.values()) {
            if (
                operation.scope.accountId !== accountId
                || state.dismissedOperationIds.has(operation.operationId)
            ) {
                continue;
            }

            if (
                operation.state === 'failed'
                && !state.terminalSeenAtById.has(operation.operationId)
            ) {
                next.push({ operation, reason: 'failed' });
                continue;
            }

            if (
                operation.state === 'succeeded'
                && resolveLocalPresentation(operation)?.kind === 'setup_needs_attention'
            ) {
                next.push({ operation, reason: 'setup_needs_attention' });
                continue;
            }

            if (
                (operation.state === 'accepted' || operation.state === 'running')
                && state.unavailableOperationIds.has(operation.operationId)
            ) {
                next.push({ operation, reason: 'status_unavailable' });
            }
        }

        if (sameInboxEntries(previous, next)) return previous;
        previous = next;
        return previous;
    };
}

export function selectActionOperationsNeedAttention(
    state: ActionOperationStoreState,
    accountId: string,
): boolean {
    for (const operation of state.operationsById.values()) {
        if (operation.scope.accountId !== accountId) continue;
        if (state.dismissedOperationIds.has(operation.operationId)) continue;
        if (operation.state === 'accepted' || operation.state === 'running') return true;
        if (!state.terminalSeenAtById.has(operation.operationId)) return true;
    }
    return false;
}
