import { describe, expect, it } from 'vitest';

import { resolveDaemonFeatureProbeServerUrl } from './featureProbeServerUrl';

describe('resolveDaemonFeatureProbeServerUrl', () => {
    it('probes the reachable API base, not the canonical public server URL', () => {
        expect(resolveDaemonFeatureProbeServerUrl({
            serverUrl: 'https://happy-sandbox.example.net:8443',
            apiServerUrl: 'http://127.0.0.1:3005',
        })).toBe('http://127.0.0.1:3005');
    });

    it('keeps working when both URLs are identical', () => {
        expect(resolveDaemonFeatureProbeServerUrl({
            serverUrl: 'https://api.happier.dev',
            apiServerUrl: 'https://api.happier.dev',
        })).toBe('https://api.happier.dev');
    });
});
