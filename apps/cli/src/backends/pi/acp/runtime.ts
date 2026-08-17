import type { McpServerConfig } from '@/agent';
import type { AcpPermissionHandler } from '@/agent/acp/AcpBackend';
import { createCatalogProviderAcpRuntime } from '@/agent/acp/runtime/createCatalogProviderAcpRuntime';
import type { SessionProviderInputConsumer } from '@/agent/runtime/sessionInput/types';
import type { ApiSessionClient } from '@/api/session/sessionClient';
import type { PermissionMode } from '@/api/types';
import type { Credentials } from '@/persistence';
import type { MessageBuffer } from '@/ui/ink/messageBuffer';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveEffectiveCodingPromptText } from '@/agent/prompting/coding/resolveEffectiveCodingPrompt';
import { resolveAgentToolsDelivery } from '@/agent/tools/happierTools/runtime/resolveAgentToolsDelivery';
import { resolveCliFeatureDecision } from '@/features/featureDecisionService';
import { logger } from '@/ui/logger';

import type { PiBackendOptions } from '@/backends/pi/acp/backend';
import { resolveHappyToolsBridgeBackendOptions } from '@/backends/pi/bridgeExtension';
import { maybeImportPiThinkingHistory } from '@/backends/pi/history/importPiThinkingHistory';
import { publishPiSessionIdMetadata } from '@/backends/pi/utils/piSessionIdMetadata';
import { resolvePiSessionIdFromResumeReference } from '@/backends/pi/utils/piSessionFiles';

export function createPiAcpRuntime(params: {
  directory: string;
  machineId: string;
  session: ApiSessionClient;
  messageBuffer: MessageBuffer;
  mcpServers: Record<string, McpServerConfig>;
  permissionHandler: AcpPermissionHandler;
  onThinkingChange: (thinking: boolean) => void;
  getSessionOpenAbortSignal?: () => AbortSignal | undefined;
  memoryRecallGuidanceEnabled?: boolean;
  getPermissionMode?: () => PermissionMode | null | undefined;
  pendingQueueDrainMaxPopPerWake?: number;
  providerInputConsumer: SessionProviderInputConsumer<unknown, unknown>;
  /**
   * Resolved account credentials. Required: the spawn-path system prompt
   * (including the tool-delivery bridge appendix) is composed from them and
   * forwarded to pi via the `--append-system-prompt` spawn flag, mirroring how
   * the claude backend resolves and forwards its system prompt.
   */
  credentials: Credentials;
  accountSettings?: Record<string, unknown> | null;
}) {
  const lastPublishedPiSessionId: { value: string | null; sessionFile?: string | null } = { value: null };
  let lastPiIdentityGeneration: number | null = null;

  // Prototype (option B): one thinking-history backfill attempt per pi session per process.
  const importedPiThinkingHistorySessionIds = new Set<string>();

  const runtime = createCatalogProviderAcpRuntime<PiBackendOptions>({
    provider: 'pi',
    loggerLabel: 'PiACP',
    directory: params.directory,
    session: params.session,
    messageBuffer: params.messageBuffer,
    mcpServers: params.mcpServers,
    permissionHandler: params.permissionHandler,
    sessionIdentity: {
      kind: 'custom',
      persistBound: async (event) => {
        if (lastPiIdentityGeneration !== event.generation) {
          lastPublishedPiSessionId.value = null;
          lastPublishedPiSessionId.sessionFile = null;
          lastPiIdentityGeneration = event.generation;
        }
        await publishPiSessionIdMetadata({
          operation: event.operation,
          session: params.session,
          getPiSessionId: () => event.vendorSessionId,
          cwd: params.directory,
          processEnv: process.env,
          lastPublished: lastPublishedPiSessionId,
        });
      },
    },
    resolveExpectedVendorSessionIdForResume: resolvePiSessionIdFromResumeReference,
    onThinkingChange: params.onThinkingChange,
    getSessionOpenAbortSignal: params.getSessionOpenAbortSignal,
    memoryRecallGuidance: {
      enabled: params.memoryRecallGuidanceEnabled === true,
      machineId: params.machineId,
    },
    getPermissionMode: params.getPermissionMode,
    backendOptions: {
      env: process.env,
    },
    pendingQueueDrainMaxPopPerWake: params.pendingQueueDrainMaxPopPerWake,
    providerInputConsumer: params.providerInputConsumer,
    inFlightSteer: { enabled: true },
    resolveBackendOptions: async ({ session }) => {
      const memoryRecallGuidanceEnabled = params.memoryRecallGuidanceEnabled === true;

      let appendSystemPromptText: string | undefined;
      try {
        const text = await resolveEffectiveCodingPromptText({
          credentials: params.credentials,
          settings: params.accountSettings ?? null,
          profileId: session.getMetadataSnapshot()?.profileId ?? null,
          providerId: 'pi',
          executionRunsFeatureEnabled: resolveCliFeatureDecision({
            featureId: 'execution.runs',
            env: process.env,
          }).state === 'enabled',
          toolDelivery: resolveAgentToolsDelivery('pi'),
          toolDeliverySessionId: session.sessionId,
          toolDeliveryDirectory: params.directory,
          memoryRecallGuidanceEnabled,
          memoryMachineId: params.machineId,
        });
        const trimmed = typeof text === 'string' ? text.trim() : '';
        appendSystemPromptText = trimmed || undefined;
      } catch (error) {
        // Best-effort: if the prompt cannot be resolved, spawn pi with no
        // append flag so it uses its own default system prompt. The tool
        // delivery appendix rides only this path, so leave a file-log trace.
        logger.debug('[pi] system prompt resolution failed; spawning without --append-system-prompt', error);
      }

      // Tools-bridge binding: derive the disable flags from the same settings/signals
      // that built the prompt so the registered tools always match what the prompt
      // advertises. When `PI_CODING_AGENT_DIR` is not set (daemon regular-process spawns
      // do not carry it), fall back to pi's native default agent dir (`~/.pi/agent`,
      // resolved from HOME) — the same root the connected-services materializer uses —
      // so every Happier-spawned Pi session gets the bridge, not just connected-service
      // launches.
      let happyToolsBridge: PiBackendOptions['happyToolsBridge'];
      try {
        const explicitAgentDir = typeof process.env.PI_CODING_AGENT_DIR === 'string'
          ? process.env.PI_CODING_AGENT_DIR.trim() || null
          : null;
        const agentDir = explicitAgentDir
          ?? join((typeof process.env.HOME === 'string' && process.env.HOME.trim()) || homedir(), '.pi', 'agent');
        const resolved = await resolveHappyToolsBridgeBackendOptions({
          agentDir,
          settings: params.accountSettings ?? null,
          memoryRecallGuidanceEnabled,
        });
        if (resolved) {
          happyToolsBridge = { ...resolved, memoryMachineId: params.machineId };
        }
      } catch (error) {
        // Best-effort: spawn without the bridge args; the shell-bridge prompt appendix
        // remains the fallback tool delivery path for this session.
        logger.debug('[pi] tools-bridge extension resolution failed; spawning without bridge args', error);
      }

      return {
        ...(appendSystemPromptText ? { appendSystemPromptText } : {}),
        ...(happyToolsBridge ? { happyToolsBridge } : {}),
      };
    },
  });

  // Prototype (option B): after a successful resume, backfill historical pi thinking blocks
  // from the JSONL into the Happier transcript as history-provenance rows. Fire-and-forget:
  // a backfill failure must never block the resumed session.
  return {
    ...runtime,
    startOrLoad: async (opts?: { resumeId?: string | null; importHistory?: boolean; deferPendingDrain?: boolean }) => {
      const vendorSessionId = await runtime.startOrLoad(opts ?? {});
      if (typeof opts?.resumeId === 'string' && opts.resumeId.trim().length > 0) {
        const piSessionReference = resolvePiSessionIdFromResumeReference(opts.resumeId) ?? vendorSessionId;
        void maybeImportPiThinkingHistory({
          session: params.session,
          directory: params.directory,
          piSessionReference,
          importedPiSessionIds: importedPiThinkingHistorySessionIds,
        }).catch((error) => {
          logger.debug('[pi] Thinking history backfill failed (non-fatal)', error);
        });
      }
      return vendorSessionId;
    },
  };
}
