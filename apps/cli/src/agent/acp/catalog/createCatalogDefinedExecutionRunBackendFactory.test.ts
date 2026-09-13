import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentBackend } from '@/agent/core';

const createCatalogAcpBackend = vi.fn();
vi.mock('@/agent/acp/createCatalogAcpBackend', () => ({
  createCatalogAcpBackend: (...args: unknown[]) => createCatalogAcpBackend(...args),
}));

import { createCatalogDefinedExecutionRunBackendFactory } from './createCatalogDefinedExecutionRunBackendFactory';

function fakeBackend(): AgentBackend {
  return {
    startSession: vi.fn(async () => ({ sessionId: 'agy-session-1' })),
    loadSession: vi.fn(async (sessionId) => ({ sessionId })),
    sendPrompt: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    onMessage: vi.fn(),
    dispose: vi.fn(async () => {}),
  };
}

describe('createCatalogDefinedExecutionRunBackendFactory', () => {
  beforeEach(() => createCatalogAcpBackend.mockReset());

  it('defers catalog backend resolution until session launch so managed prerequisites can be ensured', async () => {
    const resolved = fakeBackend();
    createCatalogAcpBackend.mockResolvedValue({ backend: resolved });
    const factory = createCatalogDefinedExecutionRunBackendFactory('agy');
    const backend = factory({
      cwd: '/workspace',
      backendId: 'agy',
      permissionMode: 'read_only',
      accountSettings: {},
      permissionHandler: { handleToolCall: vi.fn() },
    });

    expect(createCatalogAcpBackend).not.toHaveBeenCalled();
    await backend.startSession();
    expect(createCatalogAcpBackend).toHaveBeenCalledTimes(1);
    expect(createCatalogAcpBackend).toHaveBeenCalledWith('agy', expect.objectContaining({
      cwd: '/workspace',
      permissionMode: 'read-only',
      accountSettings: {},
    }));
  });

  it('shares one in-flight catalog resolution across concurrent launch calls', async () => {
    const resolved = fakeBackend();
    createCatalogAcpBackend.mockResolvedValue({ backend: resolved });
    const backend = createCatalogDefinedExecutionRunBackendFactory('agy')({
      cwd: '/workspace',
      backendId: 'agy',
      permissionMode: 'read_only',
      permissionHandler: { handleToolCall: vi.fn() },
    });

    await Promise.all([backend.startSession(), backend.loadSession?.('agy-session-existing')]);
    expect(createCatalogAcpBackend).toHaveBeenCalledTimes(1);
  });
});
