/**
 * Server base used by daemon-side runtime feature probes (`/v1/features`).
 *
 * The daemon talks to the relay through the reachable API base (`apiServerUrl`,
 * e.g. a loopback `localServerUrl`), while `serverUrl` is the canonical public
 * address that may be unreachable from the daemon host itself (self-hosted
 * relays behind tunnels/DNS that does not resolve locally). Feature probes are
 * daemon→server API calls, so they must target the API base like every other
 * daemon API client — probing the public URL silently disables feature-gated
 * daemon automation (e.g. connected-service quotas) on such hosts.
 */
export function resolveDaemonFeatureProbeServerUrl(configuration: Readonly<{
    serverUrl: string;
    apiServerUrl: string;
}>): string {
    return configuration.apiServerUrl;
}
