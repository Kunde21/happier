import type { McpServerConfig } from '@/agent';
import { normalizeCurrentHappierSessionId } from '@/agent/runtime/session/currentSessionIdEnv';
import { DEFAULT_CODEX_HAPPIER_MCP_TOOL_CALL_TIMEOUT_MS } from '@/configuration';

const CODEX_HAPPIER_READ_ONLY_MCP_TOOLS = [
    'execution_run_get',
    'execution_run_list',
    'execution_run_wait',
] as const;

function quoteTomlString(value: string): string {
    return JSON.stringify(value);
}

function serializeTomlStringArray(values: readonly string[]): string {
    return `[${values.map((value) => quoteTomlString(value)).join(',')}]`;
}

function serializeTomlInlineTable(values: Readonly<Record<string, string>>): string {
    const entries = Object.entries(values)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${quoteTomlString(value)}`);
    return `{${entries.join(',')}}`;
}

function sanitizeServerKeyFragment(name: string): string {
    const normalized = name
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return normalized.length > 0 ? normalized : 'server';
}

function assignInjectedServerKeys(serverNames: readonly string[]): Map<string, string> {
    const assigned = new Map<string, string>();
    const usedKeys = new Set<string>();

    for (const serverName of [...serverNames].sort((left, right) => left.localeCompare(right))) {
        // Prefer stable, prompt-friendly keys for our own built-in Happier MCP servers.
        // This keeps Codex tool names aligned with the canonical system-prompt guidance
        // (e.g. `mcp__happier__change_title`) and avoids awkward double-prefix names like
        // `happier__happier` for the internal Happier server.
        if ((serverName === 'happier' || serverName === 'happy') && !usedKeys.has(serverName)) {
            usedKeys.add(serverName);
            assigned.set(serverName, serverName);
            continue;
        }

        const baseKey = `happier__${sanitizeServerKeyFragment(serverName)}`;
        let candidate = baseKey;
        let suffix = 2;
        while (usedKeys.has(candidate)) {
            candidate = `${baseKey}_${suffix}`;
            suffix += 1;
        }
        usedKeys.add(candidate);
        assigned.set(serverName, candidate);
    }

    return assigned;
}

export function buildCodexAppServerConfigOverrides(
    mcpServers: Readonly<Record<string, McpServerConfig>>,
    options: Readonly<{
        happierSessionId?: string;
        happierMcpToolCallTimeoutMs?: number;
    }> = {},
): string[] {
    const serverNames = Object.keys(mcpServers);
    const injectedKeys = assignInjectedServerKeys(serverNames);
    const overrides: string[] = [];

    const happierSessionId = normalizeCurrentHappierSessionId(options.happierSessionId);
    if (happierSessionId) {
        overrides.push(`shell_environment_policy.set.HAPPIER_SESSION_ID=${quoteTomlString(happierSessionId)}`);
    }

    for (const serverName of [...serverNames].sort((left, right) => left.localeCompare(right))) {
        const config = mcpServers[serverName];
        const injectedKey = injectedKeys.get(serverName);
        if (!injectedKey) continue;

        overrides.push(`mcp_servers.${injectedKey}.command=${quoteTomlString(config.command)}`);
        if (Array.isArray(config.args) && config.args.length > 0) {
            overrides.push(`mcp_servers.${injectedKey}.args=${serializeTomlStringArray(config.args)}`);
        }
        if (config.env && Object.keys(config.env).length > 0) {
            overrides.push(`mcp_servers.${injectedKey}.env=${serializeTomlInlineTable(config.env)}`);
        }
        overrides.push(`mcp_servers.${injectedKey}.enabled=true`);
        if (serverName === 'happier' || serverName === 'happy') {
            const timeoutMs = options.happierMcpToolCallTimeoutMs
                ?? DEFAULT_CODEX_HAPPIER_MCP_TOOL_CALL_TIMEOUT_MS;
            overrides.push(`mcp_servers.${injectedKey}.tool_timeout_sec=${timeoutMs / 1_000}`);
            for (const toolName of CODEX_HAPPIER_READ_ONLY_MCP_TOOLS) {
                overrides.push(
                    `mcp_servers.${injectedKey}.tools.${toolName}.approval_mode=${quoteTomlString('approve')}`,
                );
            }
        }
    }

    return overrides;
}
