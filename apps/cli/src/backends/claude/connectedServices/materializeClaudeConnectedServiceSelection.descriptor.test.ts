import { describe, expect, it } from 'vitest';
import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';

import type { ConnectedServiceResolvedSelection } from '@/daemon/connectedServices/materialize/materializeConnectedServicesForSpawn';
import { buildClaudeSubscriptionNativeAuthSelectionDescriptor } from './materializeClaudeConnectedServiceSelection';

describe('buildClaudeSubscriptionNativeAuthSelectionDescriptor pinned groups', () => {
  // The descriptor only reads the selection's identity fields; the record is opaque to it.
  const record = buildConnectedServiceCredentialRecord({
    now: 10,
    serviceId: 'claude-subscription',
    profileId: 'member-b',
    kind: 'oauth',
    expiresAt: null,
    oauth: {
      accessToken: 'access',
      refreshToken: 'refresh',
      idToken: null,
      scope: null,
      tokenType: null,
      providerAccountId: 'provider-b',
      providerEmail: null,
    },
  });

  it('derives a profile-kind descriptor for a pinned group selection so the pinned account owns its home', () => {
    const selection: ConnectedServiceResolvedSelection = {
      kind: 'group',
      serviceId: 'claude-subscription',
      groupId: 'main',
      activeProfileId: 'member-b',
      fallbackProfileId: 'member-b',
      pinnedProfileId: 'member-b',
      generation: 4,
      credentialRevision: null,
      record,
      policy: null,
    };
    expect(buildClaudeSubscriptionNativeAuthSelectionDescriptor({
      fallbackProfileId: 'member-b',
      selection,
    })).toEqual({
      kind: 'profile',
      serviceId: 'claude-subscription',
      profileId: 'member-b',
    });
  });

  it('keeps the group descriptor for unpinned group selections', () => {
    const selection: ConnectedServiceResolvedSelection = {
      kind: 'group',
      serviceId: 'claude-subscription',
      groupId: 'main',
      activeProfileId: 'member-a',
      fallbackProfileId: 'member-a',
      generation: 4,
      credentialRevision: null,
      record,
      policy: null,
    };
    const descriptor = buildClaudeSubscriptionNativeAuthSelectionDescriptor({
      fallbackProfileId: 'member-a',
      selection,
    });
    expect(descriptor.kind).toBe('group');
  });
});
