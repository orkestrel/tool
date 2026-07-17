import type {
	ConversationStoreInterface,
	WorkspaceManagerInterface,
	WorkspaceStoreInterface,
} from '@orkestrel/agent'
import type { WorkflowRunnerInterface, WorkflowStoreInterface } from '@orkestrel/workflow'

// Tool-package types — one interface per `create*Tool` / `create*Function` factory (AGENTS §5:
// types are the SOURCE OF TRUTH; implementation conforms to them, never the reverse). The
// workflow-authoring family (WorkflowSteps/WorkflowStep/WorkflowDraft/PhaseDraft/TaskDraft) and
// AgentFunctionOptions are OWNED here now — ported byte-faithfully from `@orkestrel/workflow`
// ahead of the upstream cleanup that drops the authoring surface from that package (this package
// becomes the defining home). WorkspaceOperation is OWNED here now — ported from `@orkestrel/agent`
// for the same reason. Each tool factory's options additionally grows a single `store` (or, for
// the workspace tool, `manager` / `store`) slot — the pluggable persistence seam this package
// layers on top of the ported handler logic.

// === Draft family (the workflow tool's LENIENT authoring surface — id/name optional)
//
// A DRAFT mirrors the `WorkflowDefinition` family (`@orkestrel/workflow`) EXACTLY except `id`
// and `name` are OPTIONAL at all three levels, so a small model can omit the six identity
// strings. It is NOT a runtime form — `createWorkflowDraftContract` validates it (a provided
// id/name still has `minLength: 1`, so an explicitly-empty `id: ''` is REJECTED, not "absent"),
// and `completeDraft` synthesizes any MISSING id positionally + defaults a missing name to its
// id, yielding a strict `WorkflowDefinition` that is THEN re-validated against the strict
// contract before running (soundness preserved). `run` stays optional (a plain name string),
// mirroring the definition family.

/**
 * A draft task — a `TaskDefinition` (`@orkestrel/workflow`) with OPTIONAL `id` / `name`.
 *
 * @remarks
 * The tool synthesizes a missing `id` positionally and defaults a missing `name` to its `id`
 * ({@link import('./helpers.js').completeDraft}). A PROVIDED `id` / `name` is preserved verbatim
 * (and must be non-empty — the draft contract's `minLength: 1`).
 */
export interface TaskDraft {
	readonly id?: string
	readonly name?: string
	readonly description?: string
	/** The behavior reference — a registry key resolved against a workflow's functions registry at construction; omitted ⇒ no handler. */
	readonly run?: string
	/** Extra attempts after the first on failure (a non-negative integer); overrides the phase Runner default. Execution-only. */
	readonly retries?: number
	/** The per-attempt deadline in milliseconds (a non-negative integer); overrides the phase Runner default. Execution-only. */
	readonly timeout?: number
}

/** A draft phase — a `PhaseDefinition` (`@orkestrel/workflow`) with OPTIONAL `id` / `name` and {@link TaskDraft} tasks. */
export interface PhaseDraft {
	readonly id?: string
	readonly name?: string
	readonly description?: string
	readonly tasks: readonly TaskDraft[]
	/** Max tasks in flight at once (a resource throttle); omitted ⇒ unbounded. */
	readonly concurrency?: number
	/** The per-phase failure-policy OVERRIDE; omitted ⇒ inherits the workflow `bail`. */
	readonly bail?: boolean
}

/**
 * A draft workflow — a `WorkflowDefinition` (`@orkestrel/workflow`) with OPTIONAL `id` / `name`
 * at all three levels (workflow / phase / task).
 *
 * @remarks
 * The lenient authoring form {@link import('./factories.js').createWorkflowDraftContract}
 * validates and {@link import('./helpers.js').completeDraft} completes into a strict
 * `WorkflowDefinition`. `run` stays optional (a plain name string); the `bail` policy carries
 * over.
 */
export interface WorkflowDraft {
	readonly id?: string
	readonly name?: string
	readonly description?: string
	readonly phases: readonly PhaseDraft[]
	/** Failure policy: `false` (default) continues gracefully, `true` halts on the first failure. */
	readonly bail?: boolean
}

// === Flat-steps family (the workflow tool's ADVERTISED authoring surface — the simplest form)

/**
 * One flat step — `{ name }` — the building block of a {@link WorkflowSteps} blob.
 *
 * @remarks
 * `name` is the REGISTERED behavior name the step runs (it becomes the task's `run`, NOT a
 * human label) — resolved against a workflow-level functions registry at construction.
 */
export interface WorkflowStep {
	/** The registered behavior name this step runs (becomes the task's `run`). */
	readonly name: string
}

/**
 * The FLAT authoring blob {@link import('./factories.js').createWorkflowTool} advertises —
 * `{ name?, steps }` — the simplest surface a small model can fill.
 *
 * @remarks
 * Each {@link WorkflowStep} becomes a one-task phase, in order
 * ({@link import('./helpers.js').expandSteps}); `name` is the optional workflow name (defaulted
 * when omitted).
 */
export interface WorkflowSteps {
	readonly name?: string
	readonly steps: readonly WorkflowStep[]
}

/**
 * Options for {@link import('./factories.js').createAgentFunction} — the OPT-IN adapter that
 * wraps a live `AgentInterface` (`@orkestrel/agent`) as a `WorkflowFunction`
 * (`@orkestrel/workflow`), folding a nested workflow-authoring depth / cycle guard into its
 * closure.
 *
 * @remarks
 * All fields are optional: omitted entirely, the adapter runs the agent with no nested workflow
 * tool bound and no depth/cycle bound (depth `0`, empty ancestry).
 * - `runner` — when supplied, the adapter BINDS a depth/cycle-aware
 *   {@link import('./factories.js').createWorkflowTool} onto the agent's `context.tools` (the
 *   propagation seam), so the agent can author + run a NESTED workflow through it. Omitted ⇒ the
 *   agent runs with no workflow tool bound.
 * - `depth` — this invocation's nesting depth (default `0`); the bound workflow tool runs its
 *   nested workflow at `depth + 1`, bounded by
 *   {@link import('./constants.js').MAX_WORKFLOW_DEPTH}.
 * - `ancestry` — the workflow / agent identifiers already in this run chain (default empty); a
 *   cycle (this agent already present) is rejected with a typed `DEPTH` `WorkflowError`
 *   (`@orkestrel/workflow`).
 */
export interface AgentFunctionOptions {
	readonly runner?: WorkflowRunnerInterface
	readonly depth?: number
	readonly ancestry?: readonly string[]
}

/**
 * Options for {@link import('./factories.js').createWorkflowTool} — the depth + ancestry a
 * nested workflow run is bound at, plus the optional durable {@link WorkflowStoreInterface}
 * (`@orkestrel/workflow`) this package layers on top of the ported handler logic.
 *
 * @remarks
 * This is the PROPAGATION carrier across the agent/tool boundary. A `Tool`'s handler receives
 * ONLY the model-supplied `args` (no ambient context, no signal — see `@orkestrel/agent`'s
 * `ToolOptions`), so the run's position in the workflow→agent→workflow chain CANNOT be threaded
 * through a tool call at runtime. Instead {@link import('./factories.js').createAgentFunction}
 * CLOSES `depth` / `ancestry` over the tool at BIND time. Both are OPTIONAL: a workflow tool
 * built for a TOP-LEVEL caller omits them — its nested run starts the chain at depth `1` with
 * the bare `workflow:<id>` ancestry.
 *
 * `store` is this package's ADDITION: when supplied, the tool's handler persists the run's final
 * snapshot (`store.set(result.workflow.snapshot())`) once the run settles, so a workflow
 * authored + run through the tool is retrievable / restorable afterwards. Omitted ⇒ no
 * persistence.
 */
export interface WorkflowToolOptions {
	/** The depth the INVOKING agent runs at; the nested workflow runs at `depth + 1`. Default `0`. */
	readonly depth?: number
	/** The ancestry of the invoking run; the nested run extends it with its own `workflow:<id>`. Default empty. */
	readonly ancestry?: readonly string[]
	readonly store?: WorkflowStoreInterface
}

/**
 * Options for {@link import('./factories.js').createWorkspaceTool} — EITHER a caller-built
 * {@link WorkspaceManagerInterface} to drive directly, OR a {@link WorkspaceStoreInterface} the
 * tool constructs a fresh manager over; neither given constructs a manager over
 * `@orkestrel/agent`'s in-memory store.
 *
 * @remarks
 * - `manager` — drive THIS manager directly (its `active` workspace is what every edit / read
 *   operation targets). Takes priority over `store` when both are supplied.
 * - `store` — construct a manager over this durable {@link WorkspaceStoreInterface} (via
 *   `@orkestrel/agent`'s `createWorkspaceManager`) — used only when `manager` is omitted.
 *   The store only backs the manager's own `open` / `save` operations: the tool's edits are
 *   NOT auto-persisted — durability requires an explicit caller `save` on the manager
 *   (unlike the workflow tool's `store`, which persists each executed snapshot on settle).
 * - `name` / `description` — advertised tool overrides; default to
 *   {@link import('./constants.js').WORKSPACE_TOOL_NAME} / {@link import('./constants.js').WORKSPACE_TOOL_DESCRIPTION}.
 */
export interface WorkspaceToolOptions {
	readonly name?: string
	readonly description?: string
	readonly manager?: WorkspaceManagerInterface
	readonly store?: WorkspaceStoreInterface
}

// === Workspace operation union (OWNED here now, ported from `@orkestrel/agent`)

/**
 * One operation an agent invokes through {@link import('./factories.js').createWorkspaceTool} — a
 * FLAT, descriptive tagged union over the 13 workspace edit / read / navigation actions,
 * discriminated by the `operation` literal (AGENTS §4.8: a discriminant is named for its axis —
 * the action being performed — NEVER `kind`).
 *
 * @remarks
 * This is the SOURCE OF TRUTH the tool contract is typed to
 * ({@link import('./shapers.js').workspaceToolShape} compiles to a structurally-identical guard /
 * parser / JSON Schema). Every field is FLAT (no nested objects) — the small-model ergonomic
 * lever: a range edit is the four flat integers of the `'splice'` arm (`fromLine` /
 * `fromColumn` / `toLine` / `toColumn`), reassembled into a 1-based `Range` (`@orkestrel/agent`)
 * by `rangeOf`, never a nested `{ start, end }`. Each EDIT / READ arm maps onto exactly one
 * `WorkspaceInterface` call against the manager's ACTIVE workspace; the two REGISTRY arms
 * (`switch` / `workspaces`) drive the {@link WorkspaceManagerInterface} pointer instead —
 * `workspaces` LISTS the workspaces the model can move between, and `switch` re-points which one
 * the edit / read arms target.
 */
export type WorkspaceOperation =
	/** Read a whole text file's text by `path` from the ACTIVE workspace (a binary / absent path — or no active workspace — yields no content). */
	| { readonly operation: 'read'; readonly path: string }
	/** List every file in the ACTIVE workspace (path / state / size / lines / kind summaries); `[]` when no workspace is active. */
	| { readonly operation: 'list' }
	/** Whether a file exists at `path` in the ACTIVE workspace (`false` when no workspace is active). */
	| { readonly operation: 'has'; readonly path: string }
	/**
	 * Scan every text file for `query`, returning each hit (path + 1-based line / column + the line).
	 *
	 * @remarks
	 * `regex` treats `query` as a regular-expression source (default `false` — a literal substring);
	 * `exact` matches case-sensitively (default `true`); `limit` caps the total hits returned.
	 */
	| {
			readonly operation: 'search'
			readonly query: string
			readonly regex?: boolean
			readonly exact?: boolean
			readonly limit?: number
	  }
	/**
	 * Replace `query` with `replacement` across every text file, returning the tally.
	 *
	 * @remarks
	 * Same matching axes as `search`: `regex` (default `false`), `exact` (default `true`), `limit`
	 * (cap the total replacements).
	 */
	| {
			readonly operation: 'replace'
			readonly query: string
			readonly replacement: string
			readonly regex?: boolean
			readonly exact?: boolean
			readonly limit?: number
	  }
	/** Write (create or overwrite) the whole file at `path` with `content`. */
	| { readonly operation: 'write'; readonly path: string; readonly content: string }
	/**
	 * Splice `content` into an existing text file, replacing the 1-based range
	 * `(fromLine, fromColumn)` (INCLUSIVE) → `(toLine, toColumn)` (EXCLUSIVE).
	 *
	 * @remarks
	 * The FLAT range edit — the four positive-integer caret components reassemble into a `Range`
	 * (`@orkestrel/agent`) via `rangeOf`. An empty span (`from === to`) inserts; a span past the
	 * end is clamped. An inverted / sub-1 range throws `RANGE`; a binary target throws
	 * `MODALITY`.
	 */
	| {
			readonly operation: 'splice'
			readonly path: string
			readonly content: string
			readonly fromLine: number
			readonly fromColumn: number
			readonly toLine: number
			readonly toColumn: number
	  }
	/** Prepend `content` to the start of the file at `path` (creating it when absent). */
	| { readonly operation: 'prepend'; readonly path: string; readonly content: string }
	/** Append `content` to the end of the file at `path` (creating it when absent). */
	| { readonly operation: 'append'; readonly path: string; readonly content: string }
	/** Re-key the file `from` → `to` (overwriting an occupied target). */
	| { readonly operation: 'move'; readonly from: string; readonly to: string }
	/** Remove the file at `path` from the workspace. */
	| { readonly operation: 'remove'; readonly path: string }
	/** List the workspaces the model can move between — each `{ id, files, active }` — so it can choose an `id` to `switch` to. */
	| { readonly operation: 'workspaces' }
	/** Re-point the manager's ACTIVE workspace to the one with `id` (an unknown `id` is a lenient no-op). The edit / read arms target the active workspace from then on. */
	| { readonly operation: 'switch'; readonly id: string }

/**
 * Options for {@link import('./factories.js').createAgentTool} — the sub-agent delegation
 * defaults, the nesting-depth / cycle guard bookkeeping, and the advertised tool overrides.
 *
 * @remarks
 * - `name` / `description` — advertised tool overrides; default to
 *   {@link import('./constants.js').AGENT_TOOL_NAME} / {@link import('./constants.js').AGENT_TOOL_DESCRIPTION}.
 * - `provider` — the DEFAULT registry provider key used when a call omits `provider`; a call
 *   that supplies its own `provider` overrides this. One of `provider` (here or per-call) MUST
 *   resolve, or the handler throws a typed `TOOL` {@link import('./errors.js').AgentToolError}.
 * - `tools` — the DEFAULT registry tool-name list loaded into the delegated sub-agent; a
 *   per-call `tools` list overrides (never merges with) this default.
 * - `system` — the DEFAULT system prompt seeding the sub-agent's context; a per-call `system`
 *   overrides this.
 * - `depth` — this invocation's nesting depth (default `0`); a delegated sub-agent that itself
 *   calls this tool again runs at `depth + 1`, bounded by
 *   {@link import('./constants.js').AGENT_TOOL_DEPTH}.
 * - `ancestry` — the sub-agent identifiers already in this delegation chain (default empty); a
 *   cycle (the resolved agent already present) is rejected with a typed `DEPTH`
 *   {@link import('./errors.js').AgentToolError}.
 * - `store` — this package's ADDITION: when supplied, the handler persists the delegated
 *   sub-agent's active conversation snapshot (`store.set(agent.context.conversations.active.snapshot())`)
 *   once `agent.generate()` settles successfully, before returning — one snapshot per delegation
 *   (each `registry.build` mints a fresh conversation id, so a shared store accumulates an
 *   audit log rather than colliding). Omitted ⇒ no persistence from this tool.
 *
 * Conversation persistence for a delegated sub-agent has TWO independent seams, composable
 * together: this `store` slot persists EACH delegation's conversation individually, and/or an
 * `AgentRegistryInterface` built with `AgentRegistryOptions.store` (`@orkestrel/agent`) backs
 * EVERY agent it builds — including ones built through this tool — with a store-backed
 * `ConversationManagerInterface` of its own. Neither is required; either or both may be used.
 */
export interface AgentToolOptions {
	readonly name?: string
	readonly description?: string
	readonly provider?: string
	readonly tools?: readonly string[]
	readonly system?: string
	readonly depth?: number
	readonly ancestry?: readonly string[]
	readonly store?: ConversationStoreInterface
}

/**
 * The FLAT args {@link import('./factories.js').createAgentTool} accepts — a delegated `task`
 * plus the minimal optional `AgentJobInput` (`@orkestrel/agent`) fields a caller may override
 * per-call.
 *
 * @remarks
 * `task` becomes the seed user message in the sub-agent's rehydrated conversation
 * (`AgentJobInput.messages`). `provider` / `tools` / `system` shadow the tool's own
 * {@link AgentToolOptions} defaults for this ONE call when supplied.
 */
export interface AgentToolArguments {
	readonly task: string
	readonly provider?: string
	readonly tools?: readonly string[]
	readonly system?: string
}

/**
 * The error CODE a thrown {@link import('./errors.js').AgentToolError} carries — the SAME
 * two-code shape `@orkestrel/workflow`'s `WorkflowError` uses for its own tool guard, kept
 * distinct per package (AGENTS §14: a thrown, typed, code-bearing error, never a `{ error }`
 * return).
 *
 * @remarks
 * `TOOL` — malformed / unresolvable call args (a missing `task`, no resolvable `provider`).
 * `DEPTH` — the delegation would exceed {@link import('./constants.js').AGENT_TOOL_DEPTH}, or
 * the resolved agent is already an ancestor (a cycle).
 */
export type AgentToolErrorCode = 'TOOL' | 'DEPTH'

/**
 * The FLAT args {@link import('./factories.js').createDescribeTool} accepts — the registered
 * tool `name` whose full `description` a model wants back.
 *
 * @remarks
 * `name` must match a tool registered on the {@link import('@orkestrel/agent').ToolManagerInterface}
 * the describe tool was built over — it is looked up via `tools.tool(name)`.
 */
export interface DescribeToolArguments {
	readonly name: string
}
