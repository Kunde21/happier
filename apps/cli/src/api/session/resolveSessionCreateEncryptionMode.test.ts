import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchServerFeaturesSnapshotMock = vi.hoisted(() => vi.fn());
const axiosGetMock = vi.hoisted(() => vi.fn());

vi.mock('@/features/serverFeaturesClient', () => ({
  fetchServerFeaturesSnapshot: fetchServerFeaturesSnapshotMock,
}));

vi.mock('axios', () => ({ default: { get: axiosGetMock } }));

describe('resolveSessionCreateEncryptionMode', () => {
  beforeEach(() => {
    fetchServerFeaturesSnapshotMock.mockReset();
    axiosGetMock.mockReset();
  });

  it('does not guess an encryption mode from a transient feature failure', async () => {
    fetchServerFeaturesSnapshotMock.mockResolvedValue({ status: 'error', reason: 'timeout' });
    const { resolveSessionCreateEncryptionMode } = await import('./resolveSessionCreateEncryptionMode');

    await expect(resolveSessionCreateEncryptionMode({
      token: 'token',
      serverBaseUrl: 'https://example.test',
    })).rejects.toMatchObject({ retryable: true });
  });

  it('leaves the account preference request unbounded unless its caller supplies a budget', async () => {
    fetchServerFeaturesSnapshotMock.mockResolvedValue({
      status: 'ready',
      features: { capabilities: { encryption: { storagePolicy: 'optional' } } },
    });
    axiosGetMock.mockResolvedValue({ status: 200, data: { mode: 'plain', updatedAt: 1 } });
    const { resolveSessionCreateEncryptionMode } = await import('./resolveSessionCreateEncryptionMode');

    await expect(resolveSessionCreateEncryptionMode({
      token: 'token',
      serverBaseUrl: 'https://example.test',
    })).resolves.toMatchObject({ desiredSessionEncryptionMode: 'plain' });
    expect(axiosGetMock.mock.calls[0]?.[1]).not.toHaveProperty('timeout');
  });
});
