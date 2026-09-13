import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAgyAcpReleaseAsset } from '@/runtime/managedTools/providers/agyAcpRelease.js';
import {
  __resetAgyAcpInFlightForTests,
  getAgyAcpDepStatus,
  installAgyAcp,
  resolveExistingAgyAcpManagedBinPath,
} from './agyAcp.js';

const testConfig = vi.hoisted(() => ({ home: '' }));
vi.mock('@/configuration', () => ({
  configuration: {
    get happyHomeDir() { return testConfig.home; },
    get logsDir() { return `${testConfig.home}/logs`; },
  },
}));

const tempDirs = new Set<string>();

afterEach(async () => {
  __resetAgyAcpInFlightForTests();
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
  testConfig.home = '';
});

describe('agy-acp-server installable (EU-3)', () => {
  it('installs the pinned archive and reuses the cached executable', async () => {
    const home = await mkdtemp(join(tmpdir(), 'happier-agy-home-'));
    tempDirs.add(home);
    testConfig.home = home;

    let downloadCalls = 0;
    let extractCalls = 0;
    const installed = await installAgyAcp({
      downloadArchive: async ({ destinationPath }) => {
        downloadCalls += 1;
        await writeFile(destinationPath, 'mock-agy-archive', 'utf8');
      },
      extractArchive: async ({ extractDir }) => {
        extractCalls += 1;
        const asset = resolveAgyAcpReleaseAsset();
        await mkdir(extractDir, { recursive: true });
        const executablePath = join(extractDir, asset.executableSubpath);
        await mkdir(join(executablePath, '..'), { recursive: true });
        await writeFile(executablePath, '#!/bin/sh\necho agy_acp_server\n', 'utf8');
        return extractDir;
      },
    });
    expect(installed.ok).toBe(true);
    expect(downloadCalls).toBe(1);
    expect(extractCalls).toBe(1);

    const binPath = resolveExistingAgyAcpManagedBinPath();
    expect(binPath).not.toBeNull();

    const status = await getAgyAcpDepStatus();
    expect(status.installed).toBe(true);
    expect(status.binPath).toBe(binPath);
    expect(status.installedVersion).toBe('1.1.1');
  });

  it('rejects a managed executable whose contents changed after verified installation', async () => {
    const home = await mkdtemp(join(tmpdir(), 'happier-agy-corrupt-'));
    tempDirs.add(home);
    testConfig.home = home;

    const installed = await installAgyAcp({
      downloadArchive: async ({ destinationPath }) => {
        await writeFile(destinationPath, 'mock-agy-archive', 'utf8');
      },
      extractArchive: async ({ extractDir }) => {
        const asset = resolveAgyAcpReleaseAsset();
        await mkdir(extractDir, { recursive: true });
        const executablePath = join(extractDir, asset.executableSubpath);
        await mkdir(join(executablePath, '..'), { recursive: true });
        await writeFile(executablePath, '#!/bin/sh\necho agy_acp_server\n', 'utf8');
        return extractDir;
      },
    });
    expect(installed.ok).toBe(true);

    const binPath = resolveExistingAgyAcpManagedBinPath();
    expect(binPath).not.toBeNull();
    await writeFile(binPath!, '#!/bin/sh\necho tampered\n', 'utf8');

    const status = await getAgyAcpDepStatus();
    expect(status.installed).toBe(false);
    expect(status.binPath).toBeNull();
  });

  it('coalesces concurrent installs into one download', async () => {
    const home = await mkdtemp(join(tmpdir(), 'happier-agy-coalesce-'));
    tempDirs.add(home);
    testConfig.home = home;
    let downloadCalls = 0;
    let extractCalls = 0;
    const deps = {
      downloadArchive: async ({ destinationPath }: { destinationPath: string }) => {
        downloadCalls += 1;
        await writeFile(destinationPath, 'mock-agy-archive', 'utf8');
      },
      extractArchive: async ({ extractDir }: { extractDir: string }) => {
        extractCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        const asset = resolveAgyAcpReleaseAsset();
        await mkdir(extractDir, { recursive: true });
        await writeFile(join(extractDir, asset.executableSubpath), 'bin', 'utf8');
        return extractDir;
      },
    };

    const [first, second] = await Promise.all([installAgyAcp(deps), installAgyAcp(deps)]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(extractCalls).toBe(1);
    expect(downloadCalls).toBe(1);
  });

  it('fails clearly on unsupported platforms', async () => {
    const home = await mkdtemp(join(tmpdir(), 'happier-agy-unsupported-'));
    tempDirs.add(home);
    testConfig.home = home;
    // Unsupported platform selection itself throws in the release owner.
    expect(() => resolveAgyAcpReleaseAsset({ platform: 'darwin', arch: 'x64' })).toThrow(/unsupported/i);
    expect(resolveExistingAgyAcpManagedBinPath()).toBeNull();
  });
});
