import { join, resolve, win32 } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  resolveConnectedServiceGroupHomeDir,
  resolveConnectedServiceHomeDir,
  resolveConnectedServiceSelectionHomeDir,
} from './resolveConnectedServiceHomeDir';

describe('resolveConnectedServiceHomeDir', () => {
  it('scopes homes under the active server dir', () => {
    const dir = resolveConnectedServiceHomeDir({
      activeServerDir: join('/', 'tmp', 'happier-server'),
      serviceId: 'openai-codex',
      profileId: 'work',
      agentId: 'codex',
    });

    expect(dir).toBe(join('/', 'tmp', 'happier-server', 'daemon', 'connected-services', 'homes', 'openai-codex', 'work', 'codex'));
  });

  it('does not allow providerScopedKey to escape the base directory', () => {
    const base = resolveConnectedServiceHomeDir({
      activeServerDir: join('/', 'tmp', 'happier-server'),
      serviceId: 'openai-codex',
      profileId: 'work',
      agentId: 'codex',
    });

    const derived = resolveConnectedServiceHomeDir({
      activeServerDir: join('/', 'tmp', 'happier-server'),
      serviceId: 'openai-codex',
      profileId: 'work',
      agentId: 'codex',
      providerScopedKey: '../evil/../../key',
    });

    expect(resolve(derived).startsWith(resolve(base))).toBe(true);
    expect(derived).not.toContain('evil');
  });

  it('uses reserved group homes that cannot collide with profile id groups on POSIX paths', () => {
    const profile = resolveConnectedServiceHomeDir({
      activeServerDir: join('/', 'tmp', 'happier-server'),
      serviceId: 'openai-codex',
      profileId: 'groups',
      agentId: 'codex',
    });
    const group = resolveConnectedServiceGroupHomeDir({
      activeServerDir: join('/', 'tmp', 'happier-server'),
      serviceId: 'openai-codex',
      groupId: 'groups',
      agentId: 'codex',
    });

    expect(profile).toBe(join('/', 'tmp', 'happier-server', 'daemon', 'connected-services', 'homes', 'openai-codex', 'groups', 'codex'));
    expect(group).toBe(join('/', 'tmp', 'happier-server', 'daemon', 'connected-services', 'homes', 'openai-codex', '__groups', 'groups', 'codex'));
    expect(profile).not.toBe(group);
  });

  it('uses reserved group homes that cannot collide with profile id groups on Windows paths', () => {
    const profile = resolveConnectedServiceHomeDir({
      activeServerDir: win32.join('C:\\', 'Users', 'alice', 'happier-server'),
      serviceId: 'openai-codex',
      profileId: 'groups',
      agentId: 'codex',
      pathJoin: win32.join,
    });
    const group = resolveConnectedServiceGroupHomeDir({
      activeServerDir: win32.join('C:\\', 'Users', 'alice', 'happier-server'),
      serviceId: 'openai-codex',
      groupId: 'groups',
      agentId: 'codex',
      pathJoin: win32.join,
    });

    expect(profile).toBe(win32.join('C:\\', 'Users', 'alice', 'happier-server', 'daemon', 'connected-services', 'homes', 'openai-codex', 'groups', 'codex'));
    expect(group).toBe(win32.join('C:\\', 'Users', 'alice', 'happier-server', 'daemon', 'connected-services', 'homes', 'openai-codex', '__groups', 'groups', 'codex'));
    expect(profile).not.toBe(group);
  });
});

describe('resolveConnectedServiceSelectionHomeDir pinned group selections', () => {
  it('resolves a pinned group selection to the pinned account profile home, not the shared group home', () => {
    expect(resolveConnectedServiceSelectionHomeDir({
      activeServerDir: '/srv',
      serviceId: 'claude-subscription',
      agentId: 'claude',
      fallbackProfileId: 'unused',
      selection: { kind: 'group', groupId: 'main', pinnedProfileId: 'work' },
      pathJoin: (...parts) => parts.join('/'),
    })).toBe('/srv/daemon/connected-services/homes/claude-subscription/work/claude');
  });

  it('keeps unpinned group selections on the shared group home', () => {
    expect(resolveConnectedServiceSelectionHomeDir({
      activeServerDir: '/srv',
      serviceId: 'claude-subscription',
      agentId: 'claude',
      fallbackProfileId: 'unused',
      selection: { kind: 'group', groupId: 'main' },
      pathJoin: (...parts) => parts.join('/'),
    })).toBe('/srv/daemon/connected-services/homes/claude-subscription/__groups/main/claude');
  });

  it('resolves a pinned group selection to the pinned profile home on Windows path joins', () => {
    expect(resolveConnectedServiceSelectionHomeDir({
      activeServerDir: 'C:\\Users\\alice\\happier',
      serviceId: 'claude-subscription',
      agentId: 'claude',
      fallbackProfileId: 'unused',
      selection: { kind: 'group', groupId: 'main', pinnedProfileId: 'work' },
      pathJoin: win32.join,
    })).toBe('C:\\Users\\alice\\happier\\daemon\\connected-services\\homes\\claude-subscription\\work\\claude');
  });
});
