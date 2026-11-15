import { z } from 'zod';

import type { Message } from '@/sync/domains/messages/messageTypes';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { Platform } from 'react-native';

import {
    deleteBrowserRecord,
    readBrowserRecord,
    writeBrowserRecord,
} from './browserRecordStorage';
import {
    buildScopedKey,
    deleteWarmCacheRecordsWithPrefix,
    loadScopedRecord,
    saveScopedRecord,
} from './warmCachePersistence';

/**
 * Best-effort disk copy of a session transcript, written when bounded transcript retention
 * (`sessionTranscriptRetention` → `evictSessionMessages`) drops the hydrated transcript from
 * memory, and read back as a first-paint baseline when the session is reopened before the
 * first-open server load lands.
 *
 * The server remains the canonical authority: the hydrate path funnels through the store's
 * canonical ingest and never marks the session loaded, so the normal first-open fetch still
 * runs, still sets `isLoaded`, and newer/older pagination still reconciles coverage against
 * the server. A hydrated baseline that is older than the server produces the same
 * mixed-coverage shape as any paged session: a first-class window gap, not a fork of the load
 * pipeline.
 *
 * At-rest placement, per runtime:
 * - **Native: encrypted MMKV** through the warm-cache owner (`saveScopedRecord`).
 * - **Web + the Tauri desktop shell: IndexedDB** through `browserRecordStorage` (the
 *   device-local large-records owner). react-native-mmkv's web adapter backs onto
 *   `localStorage`, whose per-origin quota is single-digit MBs — one 10k-message transcript
 *   can consume it whole, and the next settings write then throws inside boot-path
 *   persistence (observed as a desktop failure after extended use). IndexedDB shares neither
 *   that quota nor the synchronous write path.
 *
 * Persistence is best-effort ("if possible"): a skip, a backend failure, or a missing scope
 * never blocks eviction, and every failure is logged, never propagated into callers.
 */

const SESSION_TRANSCRIPT_DISK_CACHE_PREFIX = 'session-transcript-v1';

function isWebRuntime(): boolean {
    return Platform.OS === 'web';
}

/**
 * Envelope validation only. The messages themselves were normalized by the store before they
 * were persisted, and on hydrate they re-enter through the canonical store ingest —
 * duplicating the full `Message` union here would be a second schema for the same wire shape.
 * The envelope guarantees the record is ours and each entry has an identity the store can key
 * on.
 */
const SessionTranscriptDiskCacheRecordSchema = z.object({
    v: z.literal(1),
    messages: z.array(z.object({ id: z.string().min(1) }).passthrough()),
});

function buildSessionTranscriptDiskCacheKey(
    scope: ServerAccountScope | null,
    sessionId: string,
): string | null {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) return null;
    return buildScopedKey(
        `${SESSION_TRANSCRIPT_DISK_CACHE_PREFIX}:${normalizedSessionId}`,
        scope?.serverId,
        scope?.accountId,
    );
}

export type EvictedSessionTranscriptSnapshot = Readonly<{
    messageIdsOldestFirst: readonly string[];
    messagesById: Readonly<Record<string, Message>>;
}>;

function snapshotToMessages(transcript: EvictedSessionTranscriptSnapshot): Message[] {
    const messages: Message[] = [];
    for (const messageId of transcript.messageIdsOldestFirst) {
        const message = transcript.messagesById[messageId];
        if (message) messages.push(message as Message);
    }
    return messages;
}

function serializeRecord(messages: readonly Message[]): string {
    return JSON.stringify({ v: 1, messages });
}

function parseRecord(raw: string | undefined): readonly Message[] | null {
    if (!raw) return null;
    try {
        const record = SessionTranscriptDiskCacheRecordSchema.safeParse(JSON.parse(raw));
        return record.success ? (record.data.messages as unknown as readonly Message[]) : null;
    } catch {
        return null;
    }
}

/**
 * Native (MMKV) write, synchronous. An empty transcript retires any stale copy so a re-open
 * cannot paint content the store just deliberately dropped.
 */
function persistEvictedSessionTranscriptNative(
    scope: ServerAccountScope | null,
    sessionId: string,
    transcript: EvictedSessionTranscriptSnapshot,
): boolean {
    const key = buildSessionTranscriptDiskCacheKey(scope, sessionId);
    if (!key) return false;
    const messages = snapshotToMessages(transcript);
    if (messages.length === 0) {
        saveScopedRecord(key, {});
        return false;
    }
    saveScopedRecord(key, { v: 1 as const, messages });
    return true;
}

/** Web (IndexedDB) write, asynchronous and best-effort. */
export async function persistEvictedSessionTranscriptWeb(
    scope: ServerAccountScope | null,
    sessionId: string,
    transcript: EvictedSessionTranscriptSnapshot,
): Promise<boolean> {
    const key = buildSessionTranscriptDiskCacheKey(scope, sessionId);
    if (!key) return false;
    const messages = snapshotToMessages(transcript);
    if (messages.length === 0) {
        await deleteBrowserRecord(key).catch(() => {});
        return false;
    }
    try {
        await writeBrowserRecord(key, serializeRecord(messages));
        return true;
    } catch (error) {
        console.warn(`[session-transcript-disk-cache] web write failed for session ${sessionId}`, error);
        return false;
    }
}

/**
 * Persist one session's transcript at eviction time. Synchronous callers (the store's eviction
 * reducer) never block: on web the IndexedDB write is scheduled best-effort and the return
 * value reflects the native attempt only. Every skip — no scope, empty transcript, backend
 * failure — means "evict anyway".
 */
export function persistEvictedSessionTranscript(
    scope: ServerAccountScope | null,
    sessionId: string,
    transcript: EvictedSessionTranscriptSnapshot,
): boolean {
    if (isWebRuntime()) {
        void persistEvictedSessionTranscriptWeb(scope, sessionId, transcript);
        return false;
    }
    return persistEvictedSessionTranscriptNative(scope, sessionId, transcript);
}

/** Native (MMKV) read, synchronous. A corrupt record is deleted, like every corrupt scoped record. */
function readEvictedSessionTranscriptNative(
    scope: ServerAccountScope | null,
    sessionId: string,
): readonly Message[] | null {
    const key = buildSessionTranscriptDiskCacheKey(scope, sessionId);
    if (!key) return null;
    const record = loadScopedRecord(key, SessionTranscriptDiskCacheRecordSchema);
    if (!record) return null;
    return record.messages as unknown as readonly Message[];
}

/** Web (IndexedDB) read, asynchronous and best-effort. */
export async function readEvictedSessionTranscriptWeb(
    scope: ServerAccountScope | null,
    sessionId: string,
): Promise<readonly Message[] | null> {
    const key = buildSessionTranscriptDiskCacheKey(scope, sessionId);
    if (!key) return null;
    try {
        return parseRecord(await readBrowserRecord(key));
    } catch (error) {
        console.warn(`[session-transcript-disk-cache] web read failed for session ${sessionId}`, error);
        return null;
    }
}

/**
 * Read a persisted transcript back, oldest-first. Synchronous native read; on web this is the
 * no-backend probe (async callers use `readEvictedSessionTranscriptWeb`).
 */
export function readEvictedSessionTranscript(
    scope: ServerAccountScope | null,
    sessionId: string,
): readonly Message[] | null {
    if (isWebRuntime()) return null;
    return readEvictedSessionTranscriptNative(scope, sessionId);
}

/** Drop the persisted copy (session deleted, or content intentionally emptied). */
export function deleteEvictedSessionTranscript(
    scope: ServerAccountScope | null,
    sessionId: string,
): void {
    const key = buildSessionTranscriptDiskCacheKey(scope, sessionId);
    if (!key) return;
    if (isWebRuntime()) {
        void deleteBrowserRecord(key).catch(() => {});
        return;
    }
    saveScopedRecord(key, {});
}

/**
 * Startup migration off the quota-bound localStorage origin is owned by `warmCachePersistence`
 * (`migrateSessionTranscriptDiskCacheToWebBackend`) with the rest of the origin's lifecycle.
 */

/**
 * Hydrate a reopened session from its persisted copy. Only acts when the store has no
 * materialized messages for the session (the post-eviction / first-open state), and only
 * applies through the caller's canonical ingest — it never marks the session loaded and never
 * overrides live content. Asynchronous on web (IndexedDB read); native resolves immediately.
 *
 * Returns whether a baseline was applied.
 */
export async function hydrateEvictedSessionTranscript(params: Readonly<{
    scope: ServerAccountScope | null;
    sessionId: string;
    hasMaterializedMessages: boolean;
    applyMessages: (sessionId: string, messages: readonly Message[]) => void;
}>): Promise<boolean> {
    if (params.hasMaterializedMessages) return false;
    if (!params.scope) return false;
    const messages = isWebRuntime()
        ? await readEvictedSessionTranscriptWeb(params.scope, params.sessionId)
        : readEvictedSessionTranscriptNative(params.scope, params.sessionId);
    if (!messages || messages.length === 0) return false;
    params.applyMessages(params.sessionId, messages);
    return true;
}
