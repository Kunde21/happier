import { describe, expect, it } from 'vitest';

import { resolveAgyAcpReleaseAsset } from './agyAcpRelease.js';

describe('agy_acp_server pinned release (EU-3)', () => {
  it('resolves the pinned v1.1.1 darwin-arm64 archive', () => {
    const asset = resolveAgyAcpReleaseAsset({ platform: 'darwin', arch: 'arm64' });
    expect(asset.version).toBe('1.1.1');
    expect(asset.url).toContain('1.1.1-darwin-arm64.zip');
    expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(asset.executableSubpath).toBe('agy_acp_server.par');
    expect(asset.args ?? []).toEqual([]);
  });

  it('requires --uid= on linux ACP server launches', () => {
    const x64 = resolveAgyAcpReleaseAsset({ platform: 'linux', arch: 'x64' });
    const arm64 = resolveAgyAcpReleaseAsset({ platform: 'linux', arch: 'arm64' });
    expect(x64.args).toEqual(['--uid=']);
    expect(arm64.args).toEqual(['--uid=']);
    expect(x64.executableSubpath).toBe('agy_acp_server.par');
  });

  it('covers every platform artifact published by the official ACP registry manifest', () => {
    const assets = [
      resolveAgyAcpReleaseAsset({ platform: 'darwin', arch: 'arm64' }),
      resolveAgyAcpReleaseAsset({ platform: 'linux', arch: 'x64' }),
      resolveAgyAcpReleaseAsset({ platform: 'linux', arch: 'arm64' }),
      resolveAgyAcpReleaseAsset({ platform: 'win32', arch: 'x64' }),
      resolveAgyAcpReleaseAsset({ platform: 'win32', arch: 'arm64' }),
    ];
    expect(assets).toHaveLength(5);
    expect(new Set(assets.map((asset) => asset.url)).size).toBe(5);
  });

  it('fails clearly on unsupported platforms instead of emulating', () => {
    expect(() => resolveAgyAcpReleaseAsset({ platform: 'darwin', arch: 'x64' })).toThrow(/unsupported/i);
    expect(() => resolveAgyAcpReleaseAsset({ platform: 'freebsd' as never, arch: 'x64' as never })).toThrow(/unsupported/i);
  });
});
