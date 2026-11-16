import { describe, expect, it } from 'vitest';

import {
  parseConnectedServiceBindingSelections,
  parseConnectedServicesBindings,
} from '@/daemon/connectedServices/parseConnectedServicesBindings';

describe('parseConnectedServiceBindingSelections group pin carriage', () => {
  it('carries the group binding profileId as the pinned profile alongside the released fallback meaning', () => {
    const selections = parseConnectedServiceBindingSelections({
      v: 1,
      bindingsByServiceId: {
        'claude-subscription': {
          source: 'connected',
          selection: 'group',
          groupId: 'main',
          profileId: 'work',
        },
      },
    });
    expect(selections).toEqual([
      {
        kind: 'group',
        serviceId: 'claude-subscription',
        groupId: 'main',
        pinnedProfileId: 'work',
        fallbackProfileId: 'work',
      },
    ]);
  });

  it('emits neither pin nor fallback when the group binding carries no profileId', () => {
    const selections = parseConnectedServiceBindingSelections({
      v: 1,
      bindingsByServiceId: {
        'claude-subscription': { source: 'connected', selection: 'group', groupId: 'main' },
      },
    });
    expect(selections).toEqual([
      { kind: 'group', serviceId: 'claude-subscription', groupId: 'main' },
    ]);
  });

  it('keeps parseConnectedServicesBindings on the released fallback projection (no pin semantics)', () => {
    expect(parseConnectedServicesBindings({
      v: 1,
      bindingsByServiceId: {
        'claude-subscription': { source: 'connected', selection: 'group', groupId: 'main', profileId: 'work' },
      },
    })).toEqual([{ serviceId: 'claude-subscription', profileId: 'work' }]);
  });
});
