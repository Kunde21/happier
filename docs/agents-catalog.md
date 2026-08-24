# Agents catalog (CLI + app + `@happier-dev/agents`)

This doc explains how the **Agents catalog** works end-to-end in Happier, and how to add a new agent/provider.

The goal is that both surfaces:
- stay **catalog-driven** (no screen-level `if (agentId === ...)`),
- stay **capability-driven** (runtime checks come from daemon/CLI capability results),
- stay **explicit and reviewable** (no filesystem scanning, no side-effect self-registration),
- share a stable **AgentId contract** across packages.

---

## Key concepts (shared language)

- **AgentId**: canonical id for an agent across packages (CLI + app + server).
  - Source of truth: `@happier-dev/agents` (`packages/agents/src/manifest.ts`).
- **detectKey**: CLI executable name used for detection UX and `command -v <detectKey>`-style probes.
  - Source of truth: `@happier-dev/agents` (`AGENTS_CORE[agentId].detectKey`).
- **cliSubcommand**: the primary CLI subcommand for this agent (usually the same as `AgentId`).
  - Source of truth: `@happier-dev/agents` (`AGENTS_CORE[agentId].cliSubcommand`).
- **flavorAliases**: extra strings we accept for parsing/migration (e.g. `codex-acp`).
  - Source of truth: `@happier-dev/agents` (`AGENTS_CORE[agentId].flavorAliases`).
- **Capabilities**: machine/runtime checks produced by the daemon (implemented by CLI) and consumed by the app.
  - Convention (CLI): `cli.<agentId>`, `tool.<name>`, `dep.<name>`.
- **Checklists**: higher-level groupings of capabilities that the app can render as guided setup steps.
  - Convention: `new-session`, `machine-details`, `resume.<agentId>`.
- **Session-agent tool surface**: the set of Happier built-in tools an in-session agent (Claude, Codex, OpenCode, Pi, …) can call to act on the user's Happier account — list/send across sessions, spawn, controls, memory, subagents/execution runs.
  - Source of truth: this document's [Session-agent tool surfaces](#session-agent-tool-surfaces-actions--built-in-tools) section.

---

## Session-agent tool surfaces (Actions + built-in tools)

One system feeds every provider's in-session tool inventory. The Actions settings UI toggles per-action/per-surface availability (including the **Session agent** surface Leeroy's Discord message refers to); the same catalog backs the in-session MCP tools and the CLI `tools list`/`tools call` bridge.

### How the inventory is built (owners)

1. **Action specs** — `packages/protocol/src/actions/actionSpecs.ts` declares every action with `surfaces` (flags per surface: `ui_button`, `ui_slash_command`, `voice_tool`, `voice_action_block`, `session_agent`, `mcp`, `cli`) and optional `bindings.mcpToolName` + `inputSchema`.
2. **Tool catalog** — `apps/cli/src/agent/tools/happierTools/catalog.ts` turns every spec with an `mcpToolName` into a built-in tool (`name`, `title`, `description`, `inputSchema`) and adds two manual tools: `change_title` (manual equivalent of `session.title.set`) and `action_execute` (umbrella: run any action by id with structured input — the only route for spec-only actions without a direct tool binding).
3. **Availability resolution** — `packages/protocol/src/actions/actionSurfaceAvailability.ts` (`resolveActionSurfaceAvailability`) computes `available` + reason (`available | unknown_action | missing_tool_binding | unsupported_surface | disabled_by_settings | disabled_by_policy`) + remedy. Surface filtering for tools: `apps/cli/src/agent/tools/happierTools/actionToolCatalog.ts`.
4. **Enablement (the Actions settings UI)** — `actionsSettingsV1.actions[<actionId>]` overrides: `enabled: false`, `disabledSurfaces: [...]` (e.g. disable only for `session_agent`), `approvalRequiredSurfaces: [...]`. **Default: enabled on every declared surface.** Schema owner: `packages/protocol/src/actions/actionSettings.ts`; CLI processes read the same settings from env `HAPPIER_ACTIONS_SETTINGS_V1` (`apps/cli/src/settings/actionsSettings.ts`).
5. **Execution** — `apps/cli/src/agent/tools/happierTools/dispatchBuiltInHappierTool.ts` executes with a surface context; `session_agent`-surface calls carry an approval origin bound to the calling session's transcript, so approval-required actions surface as in-session permission prompts.

### Inventory (verified 2026-08-23, `dev` @ `f3a5e40b3` + live daemon)

`happier tools list --source happier` returns **52 tools** on the CLI surface. The `session_agent` surface declares **56 actions**; **50** have direct tool bindings, **6** are spec-only (reachable via `action_execute`): `approval.request.create`, `machines.list`, `paths.list_recent`, `prompt_doc.update`, `servers.list`, `session.mode.set`. Four tools are MCP/CLI-surfaced only (not session-agent): `voice_agent_start`, `execution_run_get`, `session_target_primary_set`, `session_target_tracked_set`.

Grouped by capability (tool names as the agent sees them):

- **Cross-session communication** (the laptop ↔ work-computer scenario): `session_list`, `session_message_send`, `session_wait_idle`, `session_messages_recent_get`, `session_status_get`, `session_activity_get`, `session_history_get`, `session_transcript_get`, `session_events_get`.
- **Session spawn + control**: `session_spawn_new`, `session_stop`, `session_title_set`, `session_permission_mode_set`, `session_model_set`, `session_archive`, `session_unarchive`, `session_permission_respond`, `session_user_action_answer`, `session_goal_get`/`_set`/`_clear`, `session_work_state_get`, `session_usage_limit_wait_resume_enable`/`_cancel`/`check_now`/`_consume_reset_credit`.
- **Spawn-time discovery**: `agents_backends_list`, `agents_models_list`, `agents_session_modes_list`, `agents_config_options_list`, `sessions_spawn_profiles_list`, `sessions_spawn_connected_services_list`, `sessions_spawn_mcp_servers_preview`.
- **Subagents / execution runs / review**: `subagents_plan_start`, `subagents_delegate_start`, `execution_run_start`/`_list`/`_send`/`_stop`/`_action`/`_wait`, `review_start`.
- **Session-local catalogs**: `session_vendor_plugin_catalog_list`, `session_skill_catalog_list`.
- **Memory**: `memory_search`, `memory_get_window`, `memory_ensure_up_to_date` (spec-only: no direct binding — call via `action_execute`).
- **Action introspection**: `action_spec_search`, `action_spec_get`, `action_options_resolve`.
- **Manual/umbrella**: `change_title`, `action_execute`.

### How each provider consumes the surface today

- **Claude / Codex (native MCP delivery)**: the Happier MCP server registers the built-in tools with `surface: 'session_agent'` (`apps/cli/src/mcp/createHappierMcpServer.ts`; registration in `apps/cli/src/mcp/server/registerHappierMcpBuiltInTools.ts`). Codex additionally bridges a stdio MCP client to the HTTP server (`apps/cli/src/backends/codex/happyMcpStdioBridge.ts`).
- **shell_bridge providers (auggie, qwen, kimi, kilo, copilot, cursor, …)**: the tool-delivery prompt appendix teaches the agent to discover (`happier tools list`) and invoke (`happier tools call --source happier --tool <name> --args-json <json>`) the same catalog, with `action_execute` for ActionSpec ids (`apps/cli/src/agent/tools/happierTools/runtime/buildHappierToolsPromptAppendix.ts`).
- **Pi (tools-bridge extension)**: the generated extension (`apps/cli/src/backends/pi/bridgeExtension/piBridgeExtensionSource.ts`) bridges calls through the same `happier tools call` path, but currently registers only `change_title`, `memory_search`, `memory_get_window` — gated by launch flags. The remaining ~49 session-agent tools are callable through the bridge but never *registered*, so the model does not know they exist.

### Including the full set in the Pi tools-bridge extension

The bridge's call path is already generic; inclusion is a registration problem:

1. At generation time, inline the session-agent tool definitions (name/title/description/inputSchema, serialized from the action specs — same source `catalog.ts` uses). The asset is refreshed write-if-changed on upgrade, so the inventory tracks the protocol package.
2. At `session_start`, register every inlined tool whose action is enabled: filter by the launch flags (existing `--happy-*` gates) and by the effective actions settings. Settings reach the session runner through `HAPPIER_ACTIONS_SETTINGS_V1`; the extension itself stays config-independent by resolving the filter in the daemon and passing an explicit enabled-tool list flag, mirroring the existing flag-driven design.
3. Keep `change_title`/`memory_search`/`memory_get_window` behavior-compatible (they are the manual/memory special cases of the same catalog).
4. Approval-required actions (per `approvalRequiredSurfaces` for `session_agent`) surface as in-session permission prompts through the existing dispatch approval origin — no new approval path is needed.
5. The prompt addition should advertise the cross-session tools with the same one-line guidance the appendix gives shell-bridge agents, so the model knows `session_list`/`session_message_send`/`session_wait_idle` exist for inter-session and cross-machine flows.

---

## What lives where (sources of truth)

### 1) Shared manifest + runtime metadata: `@happier-dev/agents`

Where:
- `packages/agents/src/manifest.ts`
- `packages/agents/src/localCli.ts`
- `packages/agents/src/auth.ts`
- `packages/agents/src/acp.ts`

What belongs here:
- canonical ids/types (`AgentId`, `AGENT_IDS`)
- CLI identity contract (`detectKey`, `cliSubcommand`, `flavorAliases`)
- local CLI UX metadata (`machineLoginKey`, login support, docs URL, login launch defaults)
- declarative auth probe metadata
- built-in generic ACP launcher/runtime metadata
- resume contract (`resume.vendorResume`, `resume.vendorResumeIdField`)
- cloud-connect mapping (when applicable): `cloudConnect`

What does **not** belong here:
- app-only visual assets (images/icons)
- app navigation/routes
- CLI implementation details (argv/env/paths)

### 2) Cross-boundary contracts: `@happier-dev/protocol`

Where:
- `packages/protocol/src/*`

What belongs here:
- daemon RPC request/result shapes the app must interpret deterministically
- stable error codes (spawn/resume failures, capability errors, etc.)

Example:
- `packages/protocol/src/spawnSession.ts` defines `SpawnSessionErrorCode` + `SpawnSessionResult`.

### 3) CLI agent catalog: `apps/cli/src/backends/catalog.ts`

This is the CLI’s explicit assembly of backends into a deterministic map:
- `export const AGENTS: Record<CatalogAgentId, AgentCatalogEntry> = { ... }`
- helper resolvers such as `resolveCatalogAgentId(...)`

True provider-specific backend folders live under:
- `apps/cli/src/backends/<agentId>/**`

Generic ACP runtime/catalog machinery lives under:
- `apps/cli/src/agent/acp/**`
- `apps/cli/src/agent/acp/catalog/**`

That split is intentional:
- `apps/cli/src/backends/**` is for provider-owned implementations
- `apps/cli/src/agent/acp/**` is for provider-agnostic ACP plumbing
- built-in generic ACP agents such as Kiro are declared in `@happier-dev/agents` and consumed by the generic ACP layer

### 4) App agents catalog: `apps/ui/sources/agents/catalog/catalog.ts`

This is the app’s single public surface for screens:
- screens import from the `@/agents/catalog` entrypoint backed by `apps/ui/sources/agents/catalog/**`
- it composes:
  - **core registry** (`registry/registryCore.ts`) for identity + app config
  - **UI registry** (`registry/registryUi.ts`) for assets/visuals (lazy loaded for Node-safe tests)
  - **behavior registry** (`registry/registryUiBehavior.ts`) for provider-specific hooks

Provider code lives under:
- `apps/ui/sources/agents/providers/<agentId>/**`

---

## App registries (mental model)

There are three layers inside `apps/ui/sources/agents/`:

1) **Core registry** (`registry/registryCore.ts`)
   - identity + app-facing config (translations, settings gating, permissions, connected service UX, resume config, etc.)
   - consumes canonical ids from `@happier-dev/agents`

2) **UI registry** (`registry/registryUi.ts`)
   - app-only visuals (icons, tints, avatar overlay sizing, glyphs)
   - imported lazily by the catalog entrypoint so Node-side tests can import `@/agents/catalog` without loading native assets

3) **Behavior registry** (`registry/registryUiBehavior.ts`)
   - provider-specific hooks for:
     - experimental resume switches,
     - runtime resume gating/prefetch,
     - preflight checks/prefetch + issues,
     - spawn/resume payload extras,
     - spawn env var transforms,
     - new-session UI chips + options.

---

## Capabilities + checklists contract (CLI ↔ app)

### Capability id conventions (CLI)

Defined/used in the CLI capability system:
- `cli.<agentId>`: base “agent detected + login status + (optional) ACP capability surface” probe
- `tool.<name>`: tool capability (e.g. `tool.tmux`)
- `dep.<name>`: dependency capability (e.g. `dep.codex-acp`)

### Checklist id conventions

Checklist ids are treated as stable API between daemon and app:
- `new-session`
- `machine-details`
- `resume.<agentId>`

### ACP resume (no runtime probes)

We do **not** runtime-probe ACP `loadSession` support in normal UI/CLI flows.

Instead:
- resumability is driven by the static agents catalog + the selected backend (e.g. `codexBackendMode`)
- explicit “resume inactive session” is **fail-closed**: if `loadSession` fails, we surface the error instead of silently starting a fresh vendor session
- any ACP capability probing (e.g. `includeAcpCapabilities`) is reserved for opt-in diagnostics / e2e probes, not day-to-day UX

### Dynamic model lists

Whether a provider's model list is resolved at runtime is one catalog fact:
`AGENT_MODEL_CONFIG.<agentId>.dynamicProbe` in `@happier-dev/agents`.

- `'static-only'` — the curated `staticModels` list is the whole truth. The app does not run the
  preflight models probe and ignores any `sessionModelsV1` the session publishes.
- `'auto'` (default when omitted) — the app runs the preflight models probe on the new-session
  screen **and** consumes the in-session `sessionModelsV1` list. Both readers share this one flag,
  so flipping it turns on both.

A provider that publishes `sessionModelsV1` from its runtime and is left on `'static-only'` has an
active producer with its consumer gated off — the published list is silently discarded. Flipping
that flag is a user-visible change: the app switches to the dynamic row builder, which carries less
per-model metadata than the static one, so audit what the dynamic path drops before flipping.

Dynamic providers whose runtime starts lazily (Pi starts its process on the first prompt) publish
`sessionModelsV1` only after that first prompt, so the in-session model picker would offer nothing
but the current model and freeform custom until then. To close that window, the new-session screen
seeds the server-persisted `sessionModelsV1` from the wizard's own preflight probe at spawn
(`sync.publishSessionModelsSeedToMetadata`, wired in `useCreateNewSession`). The seed is
deliberately seed-only: if the runtime has already published for this session, the write is a
no-op, and the runtime re-publish stays authoritative. It only applies to `dynamicProbe !==
'static-only'` agents with no curated static list, and to built-in-agents spawns (not ACP custom).

A provider with both surfaces needs **one owner** for the model list. Claude's is
`apps/cli/src/backends/claude/models/resolveClaudeModelCatalog.ts`: the preflight probe adapter and
the in-session `sessionModelsV1` publisher both read it, so the two pickers cannot disagree about
which models exist or which effort tiers they report. Its provider-owned cache identity is the
normalized endpoint, credential kind, and full SHA-256 credential hash. A warm cache entry avoids a
network request; a cold session start may fetch the catalog before publishing the resolved models.
For Claude, a successful account response is authoritative for membership and API capability/context
facts; curated rows only enrich matching ids and serve as the fallback before the first success. A
later failed refresh retains the bounded last successful account snapshot, serves it during the
failure cooldown, and retries discovery after that cooldown without replacing it on repeat failure.
Effort tiers are resolved once when the session mode is built and travel on the mode, so spawn-time
resolution and launch-option hashing see the same value and hashing stays pure.

Provider-owned probing:
- Implement the probe in `apps/cli/src/backends/<provider>/preflight/**` and register it through
  `getPreflightSessionControlsProbeAdapter`. Type it as `PreflightSessionControlsProbeAdapter` —
  that is the shape the caller invokes, and its params carry `connectedServices` and
  `accountSettings`. Typing it as the narrower `PreflightModelsProbeAdapter` compiles but silently
  drops those inputs.
- Set `resolveModelsProbeVariant` on the catalog entry whenever the probe result depends on
  something other than the agent id — runtime flavor, auth method, or the bound connected account.
  The returned string partitions the probe cache; without it, results computed for one account or
  runtime mode are served to another. Codex uses this generic cache variant; Claude instead declares
  provider-owned caching and keys its catalog by the effective endpoint and credential identity.
- Fail closed to the static catalog. A probe that cannot authenticate returns `null` rather than
  probing with whatever credential happens to be in the daemon's environment.

---

## Adding a new agent/provider (end-to-end)

### Step 0 — pick the id contract (critical)

Choose a new canonical id (example): `myagent`.

Prefer:
- `AgentId === cliSubcommand === detectKey`

If you need variants, use `flavorAliases` (and keep canonical ids stable).

### Step 1 — add/extend the canonical manifest (`@happier-dev/agents`)

Edit:
- `packages/agents/src/manifest.ts`

Add/update:
- `id`, `cliSubcommand`, `detectKey`
- `flavorAliases` (if needed)
- `localCli.ts` metadata when the agent has a local CLI/auth surface
- `auth.ts` declarative probe metadata when the auth status can be described centrally
- `acp.ts` built-in ACP metadata when the built-in agent runs through generic ACP
- `resume.vendorResume` (`supported | unsupported | experimental`)
- `resume.vendorResumeIdField` (optional)
- `cloudConnect` (optional)

### Step 2 — choose between provider-specific backend code and generic ACP

If the agent needs provider-specific behavior, create:
- `apps/cli/src/backends/myagent/`

Common files (as needed):
- `cli/command.ts` (subcommand handler)
- `cli/detect.ts` (version/login probe spec)
- `cli/capability.ts` (override for `cli.myagent`, if needed)
- `daemon/spawnHooks.ts` (daemon wiring tweaks, if needed)
- `acp/backend.ts` (ACP backend, if applicable)
- `cloud/connect.ts` (cloud connect, if applicable)

If the built-in agent is generic ACP-backed, do not add a bespoke backend folder just to shell out to ACP.

Instead:
- add its built-in metadata in `@happier-dev/agents`
- let `apps/cli/src/agent/acp/catalog/**` instantiate it generically
- when provider-owned ACP behavior needs the live Happier session, expose it through the catalog entry's `getAcpRuntimeBackendOptionsResolver`; the generic catalog runner is the single place that resolves and passes those backend options. Do not branch on the agent id in the generic runner or create a second session-notification path.

Configured user-defined ACP backends/presets do not become `AgentId`s.
They live in:
- `packages/protocol/src/acpCatalog/*`
- account settings `acpCatalogSettingsV1`
- CLI generic ACP catalog loaders under `apps/cli/src/agent/acp/catalog/configured/**`

Tool normalization (if the agent emits tools):
- Ensure the CLI normalizes provider tool calls/results into canonical V2 tool shapes (so the app can render them).
- See: `docs/tool-normalization.md` (V2 schemas + normalization entrypoints + trace/fixtures workflow).

### Step 3 — export one catalog entry and wire it into the CLI catalog

For provider-specific agents, create:
- `apps/cli/src/backends/myagent/index.ts`

Pattern:

```ts
import { AGENTS_CORE } from '@happier-dev/agents';
import type { AgentCatalogEntry } from '../types';

export const agent = {
  id: AGENTS_CORE.myagent.id,
  cliSubcommand: AGENTS_CORE.myagent.cliSubcommand,
  vendorResumeSupport: AGENTS_CORE.myagent.resume.vendorResume,
  getCliCommandHandler: async () => (await import('./cli/command')).handleMyAgentCliCommand,
  getCliDetect: async () => (await import('./cli/detect')).cliDetect,
  // other hooks as needed...
} satisfies AgentCatalogEntry;
```

Then edit:
- `apps/cli/src/backends/catalog.ts`

Add:

```ts
import { agent as myagent } from '@/backends/myagent';

export const AGENTS = {
  // ...
  myagent,
};
```

### Step 4 — add the app provider folder + registries

Create provider modules:
- `apps/ui/sources/agents/providers/<agentId>/core.ts`
- `apps/ui/sources/agents/providers/<agentId>/ui.ts`
- `apps/ui/sources/agents/providers/<agentId>/uiBehavior.ts` (optional; only if you need overrides)

Wire them into registries:
- add `*_CORE` to `apps/ui/sources/agents/registry/registryCore.ts`
- add `*_UI` to `apps/ui/sources/agents/registry/registryUi.ts`
- add `*_UI_BEHAVIOR_OVERRIDE` to `apps/ui/sources/agents/registry/registryUiBehavior.ts` (only if you have overrides)

### Step 5 — update `@happier-dev/protocol` only when the boundary truly changes

If you need new daemon/app fields, add them to:
- `packages/protocol/src/*`

Then update both sides (CLI implementation + app consumer) to match the new stable contract.

### Step 6 — verify (repo-local and happy-stacks)

Repo-local:

```bash
yarn typecheck
yarn test
```

Scoped:

```bash
yarn --cwd apps/cli typecheck
yarn --cwd apps/ui typecheck
```

If you’re running this repo via happy-stacks, prefer:
- `happys typecheck happy`
- `happys test happy`

---

## Node-safe imports (tests)

Some tests import the app agents catalog in a Node environment. Avoid importing native/icon modules from code that executes during those imports.

Patterns we use:
- the catalog entrypoint lazy-loads `registry/registryUi.ts` to avoid loading image files in Node.
- if a provider behavior needs a React Native component (e.g. action chips), lazy-require it inside the hook.

---

## Anti-patterns (please don’t)

- Don’t “auto-discover” backends by scanning the filesystem. We want deterministic bundling and explicit reviewable changes.
- Don’t do side-effect self-registration (“import this file and it registers itself”). It makes ordering brittle and behavior hard to audit.
- Don’t hardcode agent-specific logic in generic screens; add a typed hook in the provider’s `uiBehavior.ts` instead.
- Don’t import native assets from code that must run in Node tests (keep assets in `registry/registryUi.ts` and lazy-load).
