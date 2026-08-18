import type { SessionTranscriptObservationProvenanceV1 } from '@happier-dev/protocol';

import type { ACPMessageData, ACPProvider } from '@/api/session/sessionMessageTypes';
import type { PiSessionEntry } from '@/backends/pi/directSessions/piEntryContext';
import { buildContextEntries } from '@/backends/pi/directSessions/piEntryContext';
import { loadPiSessionEntries } from '@/backends/pi/directSessions/pagePiTranscript';
import { resolvePiSessionFileForRuntimeSession } from '@/backends/pi/utils/piSessionIdMetadata';
import { resolvePiSessionIdFromResumeReference } from '@/backends/pi/utils/piSessionFiles';
import { logger } from '@/ui/logger';

export const PI_THINKING_HISTORY_LOCAL_ID_PREFIX = 'pi-thinking-history:v1:';

export type PiThinkingHistoryCommit = Readonly<{
  provider: ACPProvider;
  body: ACPMessageData;
  opts: Readonly<{
    localId: string;
    createdAt: number;
    provenance: SessionTranscriptObservationProvenanceV1;
    meta?: Record<string, unknown>;
  }>;
}>;

export type PiThinkingHistorySessionClient = Readonly<{
  sendAgentMessageCommittedObserved: (
    provider: ACPProvider,
    body: ACPMessageData,
    opts: {
      localId: string;
      createdAt: number;
      provenance: SessionTranscriptObservationProvenanceV1;
      meta?: Record<string, unknown>;
    },
  ) => Promise<Readonly<{ persisted: boolean; delivered: boolean }>>;
  getMetadataSnapshot?: () => Record<string, unknown> | null | undefined;
}>;

/**
 * Prototype (option B): backfill pi JSONL thinking blocks into the live Happier transcript as
 * `history`-provenance observations. Deterministic localIds make re-runs server-idempotent;
 * commits land at the transcript tail (arrival-order seq), NOT in their original turn position —
 * the transcript's seq model cannot represent in-place historical insertion.
 */
const HISTORY_PROVENANCE: SessionTranscriptObservationProvenanceV1 = { kind: 'non_dependent', source: 'history' };

export function buildPiThinkingHistoryLocalId(params: Readonly<{
  piSessionId: string;
  entryId: string;
  blockIndex: number;
}>): string {
  return `${PI_THINKING_HISTORY_LOCAL_ID_PREFIX}${params.piSessionId}:${params.entryId}:t${params.blockIndex}`;
}

/**
 * Only the entry-level JSONL timestamp is trusted for source chronology (Claude replay
 * precedent); entries without a parseable ISO timestamp are skipped rather than reordered.
 */
function readTrustworthyEntryTimestampMs(entry: PiSessionEntry): number | null {
  const raw = (entry as { timestamp?: unknown }).timestamp;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && ms > 0 ? Math.trunc(ms) : null;
}

export async function importPiThinkingHistoryV1(params: Readonly<{
  session: PiThinkingHistorySessionClient;
  piSessionId: string;
  sessionFile: string;
}>): Promise<number> {
  const entries = await loadPiSessionEntries(params.sessionFile);
  const contextEntries = buildContextEntries(entries, undefined);

  let committed = 0;
  for (const entry of contextEntries) {
    if (entry.type !== 'message') continue;
    const message = (entry as { message?: unknown }).message;
    if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
    const msg = message as { role?: unknown; content?: unknown };
    if (msg.role !== 'assistant') continue;
    if (!Array.isArray(msg.content)) continue;

    const createdAt = readTrustworthyEntryTimestampMs(entry);
    if (createdAt === null) continue;

    let thinkingBlockIndex = 0;
    for (const block of msg.content) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
      const record = block as { type?: unknown; thinking?: unknown };
      if (record.type !== 'thinking') continue;
      const blockIndex = thinkingBlockIndex++;
      const text = typeof record.thinking === 'string' ? record.thinking : '';
      if (text.length === 0) continue;

      const result = await params.session.sendAgentMessageCommittedObserved(
        'pi',
        { type: 'thinking', text },
        {
          localId: buildPiThinkingHistoryLocalId({
            piSessionId: params.piSessionId,
            entryId: entry.id,
            blockIndex,
          }),
          createdAt,
          provenance: HISTORY_PROVENANCE,
          meta: { importedFrom: 'pi-thinking-history', piSessionId: params.piSessionId },
        },
      );
      if (result.persisted) committed += 1;
    }
  }
  return committed;
}

/**
 * Resume-time entry point: resolve the pi JSONL session file for the resumed pi session and
 * run the thinking backfill once per pi session per process. The in-memory guard plus the
 * deterministic localIds keep repeated resumes idempotent server-side.
 *
 * Known prototype limitation: a session that already live-streamed thinking (post-fix runtime)
 * has those blocks committed under stream-segment localIds; this backfill cannot join them and
 * would re-append the same text. The in-memory guard only covers the current process, so
 * mixed-session duplication remains possible across daemon restarts.
 */
export async function maybeImportPiThinkingHistory(params: Readonly<{
  session: PiThinkingHistorySessionClient;
  directory: string;
  piSessionReference: string;
  importedPiSessionIds: Set<string>;
  processEnv?: NodeJS.ProcessEnv;
  resolveSessionFile?: typeof resolvePiSessionFileForRuntimeSession;
}>): Promise<number> {
  const piSessionId = resolvePiSessionIdFromResumeReference(params.piSessionReference)
    ?? params.piSessionReference;
  if (params.importedPiSessionIds.has(piSessionId)) return 0;

  const resolveSessionFile = params.resolveSessionFile ?? resolvePiSessionFileForRuntimeSession;
  const metadataSnapshot = params.session.getMetadataSnapshot?.() ?? null;
  const candidatePersistedSessionFile = (() => {
    const raw = (metadataSnapshot as { piSessionFile?: unknown } | null)?.piSessionFile;
    return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
  })();

  const sessionFile = await resolveSessionFile({
    vendorSessionReference: piSessionId,
    cwd: params.directory,
    processEnv: params.processEnv ?? process.env,
    candidatePersistedSessionFile,
  });
  if (!sessionFile) return 0;

  params.importedPiSessionIds.add(piSessionId);
  const committed = await importPiThinkingHistoryV1({
    session: params.session,
    piSessionId,
    sessionFile,
  });
  if (committed > 0) {
    logger.debug(`[pi] Thinking history backfill committed ${committed} block(s) for ${piSessionId}`);
  }
  return committed;
}
