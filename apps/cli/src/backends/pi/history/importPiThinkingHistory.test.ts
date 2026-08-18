import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { PiSessionEntry } from '@/backends/pi/directSessions/piEntryContext';

import {
  buildPiThinkingHistoryLocalId,
  importPiThinkingHistoryV1,
  PI_THINKING_HISTORY_LOCAL_ID_PREFIX,
  type PiThinkingHistorySessionClient,
  type PiThinkingHistoryCommit,
} from './importPiThinkingHistory';

function entry(partial: Partial<PiSessionEntry> & Pick<PiSessionEntry, 'type' | 'id'>): PiSessionEntry {
  return {
    parentId: null,
    timestamp: '2026-08-16T12:52:07.518Z',
    ...partial,
  } as PiSessionEntry;
}

function assistantWithThinking(
  id: string,
  parentId: string | null,
  thinkingBlocks: Array<string | null>,
  opts: { ts?: string; extraText?: boolean } = {},
): PiSessionEntry {
  const content: Array<Record<string, unknown>> = [];
  for (const thinking of thinkingBlocks) {
    if (thinking === null) {
      content.push({ type: 'thinking', thinking: '' });
    } else {
      content.push({ type: 'thinking', thinking, thinkingSignature: 'reasoning_content' });
    }
  }
  if (opts.extraText) content.push({ type: 'text', text: 'answer' });
  return entry({
    type: 'message',
    id,
    parentId,
    timestamp: opts.ts ?? '2026-08-16T12:52:12.000Z',
    message: { role: 'assistant', content, api: 'openai-completions', provider: 'zai', model: 'glm-5.3', timestamp: 1 },
  });
}

function userEntry(id: string, parentId: string | null, text: string): PiSessionEntry {
  return entry({
    type: 'message',
    id,
    parentId,
    timestamp: '2026-08-16T12:52:07.600Z',
    message: { role: 'user', content: [{ type: 'text', text }], timestamp: 1 },
  });
}

function toolResultEntry(id: string, parentId: string | null): PiSessionEntry {
  return entry({
    type: 'message',
    id,
    parentId,
    timestamp: '2026-08-16T12:52:15.000Z',
    message: { role: 'toolResult', toolCallId: 'call_1', toolName: 'bash', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 1 },
  });
}

function createFakeSession(): { client: PiThinkingHistorySessionClient; commits: PiThinkingHistoryCommit[] } {
  const commits: PiThinkingHistoryCommit[] = [];
  return {
    commits,
    client: {
      sendAgentMessageCommittedObserved: async (provider, body, opts) => {
        commits.push({ provider, body, opts });
        return { persisted: true, delivered: true };
      },
    },
  };
}

describe('importPiThinkingHistoryV1', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function writeSessionFile(entries: readonly PiSessionEntry[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'happier-pi-thinking-history-'));
    tempDirs.push(dir);
    const file = join(dir, '2026-08-16T12-52-07-518Z_01a00aa1-22de-7231-8cf7-b63743333018.jsonl');
    await writeFile(
      file,
      entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf8',
    );
    return file;
  }

  it('commits each assistant thinking block as a history-provenance observation with deterministic localIds', async () => {
    const sessionFile = await writeSessionFile([
      userEntry('61850e0d', null, 'hello'),
      assistantWithThinking('99c2ab0b', '61850e0d', ['I should greet the user.']),
      toolResultEntry('682b3f29', '99c2ab0b'),
      assistantWithThinking('c28ccb7a', '682b3f29', ['Session title set.'], { ts: '2026-08-16T12:52:25.000Z', extraText: true }),
    ]);
    const { client, commits } = createFakeSession();

    const committed = await importPiThinkingHistoryV1({
      session: client,
      piSessionId: '01a00aa1-22de-7231-8cf7-b63743333018',
      sessionFile,
    });

    expect(committed).toBe(2);
    expect(commits.map((c) => c.opts.localId)).toEqual([
      'pi-thinking-history:v1:01a00aa1-22de-7231-8cf7-b63743333018:99c2ab0b:t0',
      'pi-thinking-history:v1:01a00aa1-22de-7231-8cf7-b63743333018:c28ccb7a:t0',
    ]);
    expect(commits.every((c) => c.provider === 'pi')).toBe(true);
    expect(commits.every((c) => c.body.type === 'thinking')).toBe(true);
    expect((commits[0]!.body as { text: string }).text).toBe('I should greet the user.');
    expect((commits[1]!.body as { text: string }).text).toBe('Session title set.');
    expect(commits.every((c) => c.opts.provenance !== undefined)).toBe(true);
    expect(commits[0]!.opts.provenance).toEqual({ kind: 'non_dependent', source: 'history' });
    expect(commits[0]!.opts.createdAt).toBe(Date.parse('2026-08-16T12:52:12.000Z'));
    expect(commits[1]!.opts.createdAt).toBe(Date.parse('2026-08-16T12:52:25.000Z'));
  });

  it('skips empty thinking blocks, non-assistant entries, and entries without trustworthy timestamps', async () => {
    const sessionFile = await writeSessionFile([
      userEntry('61850e0d', null, 'hello'),
      assistantWithThinking('aaaa0001', '61850e0d', [null, 'meaningful thought']),
      assistantWithThinking('bbbb0002', 'aaaa0001', ['timestampless'], { ts: '' }),
      toolResultEntry('cccc0003', 'bbbb0002'),
    ]);
    const { client, commits } = createFakeSession();

    const committed = await importPiThinkingHistoryV1({
      session: client,
      piSessionId: '01a00aa1-22de-7231-8cf7-b63743333018',
      sessionFile,
    });

    expect(committed).toBe(1);
    expect((commits[0]!.body as { text: string }).text).toBe('meaningful thought');
    expect(commits[0]!.opts.localId).toBe('pi-thinking-history:v1:01a00aa1-22de-7231-8cf7-b63743333018:aaaa0001:t1');
  });

  it('indexes multiple thinking blocks inside one assistant message distinctly', async () => {
    const sessionFile = await writeSessionFile([
      assistantWithThinking('aaaa0001', null, ['first block', 'second block']),
    ]);
    const { client, commits } = createFakeSession();

    await importPiThinkingHistoryV1({
      session: client,
      piSessionId: 's1',
      sessionFile,
    });

    expect(commits.map((c) => c.opts.localId)).toEqual([
      'pi-thinking-history:v1:s1:aaaa0001:t0',
      'pi-thinking-history:v1:s1:aaaa0001:t1',
    ]);
  });

  it('follows only the active branch (last non-header entry as leaf)', async () => {
    const sessionFile = await writeSessionFile([
      userEntry('root00001', null, 'hello'),
      assistantWithThinking('aaaa0001', 'root00001', ['on abandoned branch']),
      assistantWithThinking('bbbb0001', 'root00001', ['on active branch']),
    ]);
    const { client, commits } = createFakeSession();

    await importPiThinkingHistoryV1({
      session: client,
      piSessionId: 's1',
      sessionFile,
    });

    // bbbb0001 is the newest entry, so the leaf->root walk covers root + bbbb0001 only;
    // the abandoned sibling branch is not part of the active context.
    expect(commits.map((c) => (c.body as { text: string }).text)).toEqual(['on active branch']);
  });
});

describe('buildPiThinkingHistoryLocalId', () => {
  it('builds stable prefixed localIds', () => {
    expect(buildPiThinkingHistoryLocalId({ piSessionId: 's1', entryId: 'e1', blockIndex: 0 })).toBe(
      `${PI_THINKING_HISTORY_LOCAL_ID_PREFIX}s1:e1:t0`,
    );
    expect(buildPiThinkingHistoryLocalId({ piSessionId: 's1', entryId: 'e1', blockIndex: 0 })).toBe(
      buildPiThinkingHistoryLocalId({ piSessionId: 's1', entryId: 'e1', blockIndex: 0 }),
    );
  });
});
