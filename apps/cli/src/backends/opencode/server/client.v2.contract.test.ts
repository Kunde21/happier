import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenCodeServerRuntimeClient } from './client';

// OpenCode V2 wire fixtures are pinned to upstream commit
// 95daf90670b7c039c436c85537da5fbfe2205b41.
describe('OpenCodeServerRuntimeClient V2 contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('selects authenticated V2 and normalizes wrapped sessions, messages, prompt, and events', async () => {
    const calls: Array<{ path: string; method: string; authorization?: string; body?: unknown }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({
        path: url.pathname,
        method: init?.method ?? 'GET',
        authorization: new Headers(init?.headers).get('authorization') ?? undefined,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const body = url.pathname === '/api/health' ? { healthy: true }
        : url.pathname === '/global/health' ? { error: 'not found' }
        : url.pathname === '/api/session' && init?.body ? { data: { id: 's1', location: { directory: '/repo' } } }
        : url.pathname === '/api/session' ? { data: [{ id: 's1', location: { directory: '/repo' } }] }
        : url.pathname === '/api/session/s1' ? { data: { id: 's1', location: { directory: '/repo' } } }
        : url.pathname === '/api/session/s1/message' ? { data: [
          { id: 'u1', type: 'user', time: { created: 1 }, text: 'hello' },
          { id: 'a1', type: 'assistant', time: { created: 2 }, agent: 'build', model: { providerID: 'p', modelID: 'm' }, content: [{ type: 'text', id: 'prt_1', text: 'hi' }] },
        ], cursor: null }
        : url.pathname === '/api/session/s1/prompt' ? { data: { id: 'u2', type: 'user', time: { created: 3 }, text: 'next' } }
        : url.pathname.includes('/permission/') || url.pathname.includes('/question/') ? { data: true }
        : {};
      if (url.pathname === '/api/event') {
        const encoder = new TextEncoder();
        const frames = [
          { id: 'e1', type: 'server.connected', data: {} },
          {
            id: 'e2',
            type: 'session.next.text.ended',
            data: { timestamp: 3, sessionID: 's1', assistantMessageID: 'a1', textID: 'prt_1', text: 'hi' },
            durable: { aggregateID: 's1', seq: 2, version: 1 },
            location: { directory: '/repo' },
          },
          { id: 'e3', type: 'permission.asked', data: { id: 'per_1', sessionID: 's1', action: 'bash', resources: ['git status'], save: ['git *'], metadata: {} }, location: { directory: '/repo' } },
          { id: 'e4', type: 'question.asked', data: { id: 'que_1', sessionID: 's1', questions: [] }, location: { directory: '/repo' } },
          { id: 'e5', type: 'todo.updated', data: { sessionID: 's1', todos: [{ id: 'todo-1', content: 'ship it', status: 'pending', priority: 'high' }] }, durable: { aggregateID: 's1', seq: 5, version: 1 }, location: { directory: '/repo' } },
          { id: 'e6', type: 'session.next.execution.settled', data: { timestamp: 4, sessionID: 's1', outcome: 'success' }, durable: { aggregateID: 's1', seq: 6, version: 1 }, location: { directory: '/repo' } },
        ];
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')));
            controller.close();
          },
        }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      const noContent = /\/(?:permission|question)\/[^/]+\/(?:reply|reject)$/u.test(url.pathname);
      return new Response(noContent ? null : JSON.stringify(body), {
        status: noContent ? 204 : url.pathname === '/global/health' ? 404 : 200,
        headers: noContent ? undefined : { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = await createOpenCodeServerRuntimeClient({
      directory: '/repo',
      messageBuffer: { push: () => {} } as never,
      env: {
        HAPPIER_OPENCODE_SERVER_URL: 'http://127.0.0.1:9999',
        OPENCODE_SERVER_USERNAME: 'alice',
        OPENCODE_SERVER_PASSWORD: 'secret',
      },
    });

    await expect(client.sessionList()).resolves.toEqual([{ id: 's1', directory: '/repo' }]);
    await expect(client.sessionCreate({ permission: [{ permission: 'read', action: 'allow' }] })).resolves.toEqual({ id: 's1', directory: '/repo' });
    expect(calls).toContainEqual(expect.objectContaining({ path: '/api/session', method: 'POST', body: { location: { directory: '/repo' } } }));
    await expect(client.sessionUpdate({ sessionId: 's1', permission: [{ permission: 'read', action: 'allow' }] })).resolves.toEqual({ id: 's1', directory: '/repo' });
    await expect(client.sessionMessagesList({ sessionId: 's1' })).resolves.toEqual([
      { info: { id: 'u1', role: 'user', sessionID: 's1', time: { created: 1 } }, parts: [{ type: 'text', text: 'hello' }] },
      { info: { id: 'a1', role: 'assistant', sessionID: 's1', time: { created: 2 }, agent: 'build', model: { providerID: 'p', modelID: 'm' } }, parts: [{ type: 'text', id: 'prt_1', text: 'hi', sessionID: 's1', messageID: 'a1' }] },
    ]);
    await client.sessionPromptAsync({ sessionId: 's1', messageId: 'u2', parts: [
      { type: 'text', text: 'next' },
      { type: 'file', url: 'file:///repo/a.png', mime: 'image/png', filename: 'a.png' },
    ] });
    expect(calls.find((call) => call.path === '/api/session/s1/prompt')?.body).toEqual({
      id: 'u2', prompt: { text: 'next', files: [{ uri: 'file:///repo/a.png', name: 'a.png' }] },
    });
    expect(calls.every((call) => call.authorization === `Basic ${Buffer.from('alice:secret').toString('base64')}`)).toBe(true);

    const abort = new AbortController();
    const received: unknown[] = [];
    await client.subscribeGlobalEvents({ signal: abort.signal, onEvent: (event, delivery) => {
      received.push({ event, delivery });
      if (event.payload.type === 'session.idle') abort.abort();
    } });
    await vi.waitFor(() => expect(received).toHaveLength(6));
    expect(received[1]).toEqual({
      event: { directory: '/repo', payload: { type: 'session.next.text.ended', properties: { timestamp: 3, sessionID: 's1', assistantMessageID: 'a1', textID: 'prt_1', text: 'hi' } } },
      delivery: { provenance: 'accepted-live', connectionGeneration: 1 },
    });
    expect(received[2]).toEqual({
      event: { directory: '/repo', payload: { type: 'permission.asked', properties: { id: 'per_1', sessionID: 's1', permission: 'bash', patterns: ['git status'], always: ['git *'], metadata: {} } } },
      delivery: { provenance: 'accepted-live', connectionGeneration: 1 },
    });
    expect(received[5]).toEqual({
      event: { directory: '/repo', payload: { type: 'session.idle', properties: { sessionID: 's1' } } },
      delivery: { provenance: 'accepted-live', connectionGeneration: 1 },
    });
    await expect(client.permissionReply({ requestId: 'per_1', reply: 'once' })).resolves.toBe(true);
    await expect(client.questionReply({ requestId: 'que_1', answers: [[]] })).resolves.toBe(true);
    await expect(client.sessionTodo({ sessionId: 's1' })).resolves.toEqual([{ id: 'todo-1', content: 'ship it', status: 'pending', priority: 'high' }]);
    await client.dispose();
  });

  it('keeps every V2 route and envelope adaptation inside the client boundary', async () => {
    const calls: Array<{ path: string; method: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      calls.push({ path: url.pathname, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const body = url.pathname === '/api/health' ? { healthy: true, version: '0.0.0-beta-18050' }
        : url.pathname === '/global/health' ? { healthy: true, version: '1.1.0-beta.7' }
        : url.pathname === '/api/session/s1' ? { data: { id: 's1', location: { directory: '/repo' } } }
        : url.pathname === '/session/s1/diff' ? [{ file: 'a.ts', before: '', after: 'x' }]
        : url.pathname === '/api/session/active' ? { data: { s1: { type: 'running' } }, watermarks: {} }
        : url.pathname === '/api/agent' ? { location: { directory: '/repo' }, data: [{ name: 'build' }] }
        : url.pathname === '/api/skill' ? { location: { directory: '/repo' }, data: [{ name: 'review' }] }
        : url.pathname === '/api/provider' ? { location: { directory: '/repo' }, data: [{ id: 'openai', models: {} }] }
        : url.pathname === '/api/permission/request' ? { location: { directory: '/repo' }, data: [{ id: 'per_1', sessionID: 's1', action: 'bash', resources: ['git status'], save: ['git *'], metadata: {} }] }
        : url.pathname === '/api/question/request' ? { location: { directory: '/repo' }, data: [{ id: 'que_1', sessionID: 's1', questions: [] }] }
        : url.pathname === '/session/s1/fork' ? { id: 's2', directory: '/repo' }
        : { data: true };
      const noContent = /\/(?:permission|question)\/[^/]+\/(?:reply|reject)$/u.test(url.pathname);
      return new Response(noContent ? null : JSON.stringify(body), {
        status: noContent ? 204 : 200,
        headers: noContent ? undefined : { 'content-type': 'application/json' },
      });
    }));

    const client = await createOpenCodeServerRuntimeClient({
      directory: '/repo', messageBuffer: { push: () => {} } as never,
      env: { HAPPIER_OPENCODE_SERVER_URL: 'http://127.0.0.1:9999' },
    });

    await expect(client.sessionGet({ sessionId: 's1' })).resolves.toEqual({ id: 's1', directory: '/repo' });
    await expect(client.sessionTodo({ sessionId: 's1' })).resolves.toEqual([]);
    await expect(client.sessionDiff({ sessionId: 's1' })).resolves.toHaveLength(1);
    await expect(client.sessionStatusList()).resolves.toEqual({ s1: { type: 'running' } });
    await expect(client.globalConfigGet()).resolves.toEqual({});
    await expect(client.agentsList()).resolves.toEqual([{ name: 'build' }]);
    await expect(client.appSkills()).resolves.toEqual([{ name: 'review' }]);
    await expect(client.providersList()).resolves.toEqual([{ id: 'openai', models: {} }]);
    await expect(client.permissionList()).resolves.toEqual([{ id: 'per_1', sessionID: 's1', permission: 'bash', patterns: ['git status'], always: ['git *'], metadata: {} }]);
    await expect(client.questionList()).resolves.toEqual([{ id: 'que_1', sessionID: 's1', questions: [] }]);
    await expect(client.permissionReply({ requestId: 'per_1', reply: 'once' })).resolves.toBe(true);
    await expect(client.questionReply({ requestId: 'que_1', answers: [[]] })).resolves.toBe(true);
    await expect(client.questionReject({ requestId: 'que_1' })).resolves.toBe(true);
    await expect(client.sessionFork({ sessionId: 's1', messageId: 'a1' })).resolves.toEqual({ id: 's2', directory: '/repo' });
    await client.sessionSummarize({ sessionId: 's1', model: { providerID: 'openai', modelID: 'gpt-5' } });
    await client.sessionAbort({ sessionId: 's1' });

    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/session/s1/diff', method: 'GET' }),
      expect.objectContaining({ path: '/api/session/active', method: 'GET' }),
      expect.objectContaining({ path: '/api/session/s1/permission/per_1/reply', method: 'POST', body: { reply: 'once' } }),
      expect.objectContaining({ path: '/api/session/s1/question/que_1/reply', method: 'POST', body: { answers: [[]] } }),
      expect.objectContaining({ path: '/api/session/s1/question/que_1/reject', method: 'POST' }),
      expect.objectContaining({ path: '/api/session/s1/compact', method: 'POST' }),
      expect.objectContaining({ path: '/api/session/s1/interrupt', method: 'POST' }),
    ]));
  });

  it('fails loudly for dynamic MCP on pure V2 and permits an exact dual-surface beta', async () => {
    const makeClient = async (legacyHealth: unknown, legacyStatus = 200) => {
      vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        const body = path === '/api/health' ? { healthy: true }
          : path === '/global/health' ? legacyHealth
          : { bridge: { status: 'connected' } };
        return new Response(JSON.stringify(body), { status: path === '/global/health' ? legacyStatus : 200 });
      }));
      return await createOpenCodeServerRuntimeClient({
        directory: '/repo', messageBuffer: { push: () => {} } as never,
        env: { HAPPIER_OPENCODE_SERVER_URL: 'http://127.0.0.1:9999' },
      });
    };

    const pureV2 = await makeClient({ healthy: true }, 404);
    await expect(pureV2.mcpAdd({ name: 'bridge', config: {} })).rejects.toThrow(/V2.*MCP.*unavailable/i);
    await expect(pureV2.sessionDiff({ sessionId: 's1' })).rejects.toThrow(/V2.*diff.*unavailable/i);
    await expect(pureV2.sessionFork({ sessionId: 's1' })).rejects.toThrow(/V2.*fork.*unavailable/i);
    await expect(pureV2.sessionUpdate({ sessionId: 's1', title: 'renamed' })).rejects.toThrow(/V2.*title.*unavailable/i);

    const beta = await makeClient({ healthy: true, version: '1.1.0-beta.7' });
    await expect(beta.mcpAdd({ name: 'bridge', config: {} })).resolves.toEqual({ status: 'connected' });
  });
});
