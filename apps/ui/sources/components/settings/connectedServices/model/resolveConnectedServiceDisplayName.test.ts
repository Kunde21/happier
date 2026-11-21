import { describe, expect, it } from 'vitest';

import { resolveConnectedServiceDisplayNameKey } from './resolveConnectedServiceDisplayName';

describe('resolveConnectedServiceDisplayNameKey', () => {
    it('resolves a dedicated translation key for GitHub', () => {
        expect(resolveConnectedServiceDisplayNameKey('github')).toBe('connectedServices.serviceNames.github');
    });

    it('resolves a dedicated translation key for OpenCode Go', () => {
        expect(resolveConnectedServiceDisplayNameKey('opencode-go' as never)).toBe('connectedServices.serviceNames.opencodeGo');
    });
});
