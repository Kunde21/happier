import { describe, expect, it } from 'vitest';

import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';

import { buildInboxSessionSourceSignature } from './useInboxSessionState';

describe('buildInboxSessionSourceSignature', () => {
    it('invalidates the mounted Inbox projection when the canonical runtime failure changes', () => {
        const session = createSessionFixture({
            latestTurnStatus: 'failed',
            latestTurnStatusObservedAt: 1_000,
            lastRuntimeIssue: null,
        });
        const before = buildInboxSessionSourceSignature(session);

        expect(buildInboxSessionSourceSignature({
            ...session,
            lastRuntimeIssue: {
                v: 1,
                scope: 'primary_session',
                status: 'failed',
                source: 'stream_error',
                code: 'provider_error',
                occurredAt: 1_000,
                sanitizedPreview: 'Provider failed',
            },
        })).not.toBe(before);
    });
});
