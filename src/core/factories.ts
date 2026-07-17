import type { ContractInterface } from '@orkestrel/contract'
import type {
	AgentInterface,
	AgentRegistryInterface,
	ToolInterface,
	ToolManagerInterface,
	WorkspaceManagerInterface,
} from '@orkestrel/agent'
import type {
	WorkflowDefinition,
	WorkflowFunction,
	WorkflowRunnerInterface,
} from '@orkestrel/workflow'
import type {
	AgentFunctionOptions,
	AgentToolOptions,
	WorkflowDraft,
	WorkflowSteps,
	WorkflowToolOptions,
	WorkspaceOperation,
	WorkspaceToolOptions,
} from './types.js'
import {
	createTool,
	createWorkspaceManager,
	isText,
	rangeOf,
	WorkspaceError,
} from '@orkestrel/agent'
import { createContract, schemaToParameters } from '@orkestrel/contract'
import { createWorkflowContract, WorkflowError } from '@orkestrel/workflow'
import {
	AGENT_TOOL_DEPTH,
	AGENT_TOOL_DESCRIPTION,
	AGENT_TOOL_NAME,
	MAX_WORKFLOW_DEPTH,
	WORKFLOW_TOOL_DESCRIPTION,
	WORKFLOW_TOOL_NAME,
	WORKSPACE_TOOL_DESCRIPTION,
	WORKSPACE_TOOL_NAME,
} from './constants.js'
import { AgentToolError } from './errors.js'
import {
	agentTag,
	completeDraft,
	expandSteps,
	workflowTag,
	workflowToolSummary,
} from './helpers.js'
import {
	agentToolShape,
	workflowDraftShape,
	workflowStepsShape,
	workspaceToolShape,
} from './shapers.js'

// This package's tool factories. `createWorkflowTool` / `createWorkspaceTool` OWN their full
// handler logic now (ported byte-faithfully from `@orkestrel/workflow` / `@orkestrel/agent` ahead
// of the upstream cleanup that drops the authoring surface from those packages) and additionally
// layer a pluggable store slot on top; `createAgentTool` is net-new: sub-agent delegation over an
// `AgentRegistryInterface`.

/**
 * Wrap a registered tool as a {@link WorkflowFunction} (`@orkestrel/workflow`) — the OPT-IN
 * adapter that lets a `function`-form task run a `@orkestrel/agent` tool BY NAME.
 *
 * @remarks
 * OWNED here now (ported from `@orkestrel/workflow`). Composes into a caller's
 * `WorkflowOptions.functions` registry like any other behavior
 * (`{ publish: createToolFunction(tools, 'publish') }`); the pure workflow runner has no
 * knowledge of tools itself. The returned function executes `name` against `tools` with the
 * task's `controller.input` as the call arguments, id-correlated to the task's own id. A
 * `ToolManagerInterface.execute` (`@orkestrel/agent`) NEVER throws (a handler throw is isolated
 * into `result.error`), so a failing tool is surfaced here as a THROWN `Error` carrying the
 * original message as `cause` — the leaf `fail`s, honouring `bail`. An UNREGISTERED tool name is
 * a programmer error (an explicit binding to a name that doesn't exist) — unlike the engine's
 * own silent auto-complete of an unresolved task handler, this THROWS a typed `TOOL`
 * `WorkflowError` (`@orkestrel/workflow`).
 *
 * @param tools - The `ToolManagerInterface` (`@orkestrel/agent`) the named tool is registered on
 * @param name - The registered tool's name
 * @returns A {@link WorkflowFunction} that runs the named tool
 *
 * @example
 * ```ts
 * import { createToolFunction } from '@src/core'
 * import { createToolManager } from '@orkestrel/agent'
 * import { createWorkflowRunner } from '@orkestrel/workflow'
 *
 * const tools = createToolManager()
 * tools.add(myPublishTool)
 * const runner = createWorkflowRunner()
 * await runner.execute(definition, { functions: { publish: createToolFunction(tools, 'publish') } })
 * ```
 */
export function createToolFunction(tools: ToolManagerInterface, name: string): WorkflowFunction {
	return async (controller) => {
		const tool = tools.tool(name)
		if (tool === undefined) {
			throw new WorkflowError('TOOL', `tool '${name}' is not registered`, { tool: name })
		}
		const result = await tools.execute({
			id: controller.task.id,
			name,
			arguments: controller.input,
		})
		// A `tool` result NEVER throws — the manager isolates a handler throw into `result.error`.
		// Surface that as a task failure (so a failing tool `fail`s the leaf, honouring `bail`).
		// The manager already flattened the original throw to a string, so the message IS the
		// richest surviving detail — `cause` carries that same string, nothing deeper exists.
		if (result.error !== undefined) throw new Error(result.error, { cause: result.error })
		return result.value
	}
}

/**
 * Wrap a live `AgentInterface` (`@orkestrel/agent`) as a {@link WorkflowFunction}
 * (`@orkestrel/workflow`) — the OPT-IN adapter that runs the agent to a settled result, folding
 * a nested workflow-authoring depth / cycle guard into its own closure.
 *
 * @remarks
 * OWNED here now (ported from `@orkestrel/workflow`). Composes into a caller's
 * `WorkflowOptions.functions` registry like any other behavior; the pure workflow runner has no
 * knowledge of agents itself. Before running the agent, the depth/cycle guard REJECTS the call
 * (a THROWN typed `DEPTH` `WorkflowError`, which the leaf `fail`s) when running it would push a
 * nested chain past {@link import('./constants.js').MAX_WORKFLOW_DEPTH}, OR when this agent is
 * already an ancestor (a cycle). When {@link import('./types.js').AgentFunctionOptions.runner}
 * is supplied, the adapter BINDS a depth/cycle-aware {@link createWorkflowTool} onto the agent's
 * `context.tools` (the propagation seam) — closed over `depth` and the extended ancestry (the
 * tool itself computes `depth + 1` internally) — so the agent can author + run a NESTED workflow
 * through it; the wrapped default is the CURRENT task's own workflow id (used only on a no-args
 * tool call). The task's cancellation folds into the agent run: an already-aborted
 * `controller.signal` cancels the agent up front; otherwise a one-shot listener fires
 * `agent.abort(reason)` when the task cancels, removed in `finally`. `agent.generate()` resolves
 * a partial `AgentResult` on a cancel (never rejects), returned as the task's completed value.
 *
 * A bound agent is effectively SINGLE-RUN: `context.tools.add` binds one `ToolInterface` under
 * the fixed {@link import('./constants.js').WORKFLOW_TOOL_NAME}, and `agent.generate()` /
 * `agent.abort()` are per-agent state. Two CONCURRENT tasks sharing the SAME `agent` instance
 * race on that one tool binding (last-write-wins) and on generate/abort — give each concurrent
 * task its OWN agent instance.
 *
 * @param agent - The live `AgentInterface` to run
 * @param options - The nested-workflow binding + depth/cycle bookkeeping (see {@link import('./types.js').AgentFunctionOptions})
 * @returns A {@link WorkflowFunction} that runs `agent` to its settled result
 *
 * @example
 * ```ts
 * import { createAgentFunction } from '@src/core'
 * import { createWorkflowRunner } from '@orkestrel/workflow'
 *
 * const runner = createWorkflowRunner()
 * const review = createAgentFunction(myAgent, { runner })
 * await runner.execute(definition, { functions: { review } })
 * ```
 */
export function createAgentFunction(
	agent: AgentInterface,
	options?: AgentFunctionOptions,
): WorkflowFunction {
	return async (controller) => {
		const depth = options?.depth ?? 0
		const ancestry = options?.ancestry ?? []
		// GUARD (before running the agent): running it would let it author + run a NESTED workflow
		// at `depth + 1`, so reject when that would exceed the bound, OR when this agent is already
		// an ancestor (a re-entry cycle). The throw becomes the leaf's typed `DEPTH` failure.
		if (depth + 1 > MAX_WORKFLOW_DEPTH) {
			throw new WorkflowError('DEPTH', `agent '${agent.id}' exceeds max workflow depth`, {
				agent: agent.id,
				depth,
				max: MAX_WORKFLOW_DEPTH,
			})
		}
		const tag = agentTag(agent.id)
		if (ancestry.includes(tag)) {
			throw new WorkflowError('DEPTH', `agent '${agent.id}' is already an ancestor (cycle)`, {
				agent: agent.id,
				ancestry: [...ancestry],
			})
		}
		// BIND the workflow tool so the agent can fan out into a nested workflow at `depth + 1` with
		// THIS agent added to the ancestry — the propagation across the agent/tool boundary (closed
		// over the tool at bind time, since a tool handler receives no ambient context). The current
		// task's own workflow id is the tool's WRAPPED default, used only on a no-args call.
		const runner = options?.runner
		if (runner !== undefined) {
			const workflowId = controller.task.phase.workflow.id
			const wrapped: WorkflowDefinition = { id: workflowId, name: workflowId, phases: [] }
			agent.context.tools.add(
				createWorkflowTool(wrapped, runner, { depth, ancestry: [...ancestry, tag] }),
			)
		}
		// Fold the task's cancellation into the agent run: an already-aborted signal cancels the
		// agent up front; otherwise a one-shot listener fires `agent.abort(reason)` when the task
		// cancels. `generate()` RESOLVES a partial on a cancel (never rejects).
		const signal = controller.signal
		const onAbort = (): void => agent.abort(signal.reason)
		if (signal.aborted) {
			agent.abort(signal.reason)
		} else {
			signal.addEventListener('abort', onAbort, { once: true })
		}
		try {
			return await agent.generate()
		} finally {
			signal.removeEventListener('abort', onAbort)
		}
	}
}

/**
 * Compile the LENIENT workflow DRAFT contract — identical to `createWorkflowContract`
 * (`@orkestrel/workflow`) EXCEPT `id` and `name` are OPTIONAL at all three levels (workflow /
 * phase / task), so a small model can omit the six identity strings.
 *
 * @remarks
 * The widened authoring surface {@link createWorkflowTool} parses an authored blob through
 * before {@link import('./helpers.js').completeDraft} fills the missing ids/names. It does NOT
 * relax the canonical contract — `createWorkflowContract` (`@orkestrel/workflow`) stays
 * byte-for-byte unchanged and STRICT, and the completed draft is re-validated against THAT
 * strict gate before running (soundness preserved). A PROVIDED `id` / `name` still carries
 * `minLength: 1`, so an explicitly-empty `id: ''` is REJECTED (parses to `undefined`), never
 * auto-filled — keeping "garbage" distinct from "omitted". `run` stays optional (a plain name
 * string).
 *
 * @returns The compiled {@link import('./types.js').WorkflowDraft} contract
 *
 * @example
 * ```ts
 * import { createWorkflowDraftContract, completeDraft } from '@src/core'
 *
 * const draft = createWorkflowDraftContract()
 * const parsed = draft.parse({ phases: [{ tasks: [{ run: 'compile' }] }] })
 * const definition = parsed && completeDraft(parsed) // ids/names filled positionally
 * draft.parse({ id: '', phases: [] }) // undefined — an explicit empty id is rejected
 * ```
 */
export function createWorkflowDraftContract(): ContractInterface<WorkflowDraft> {
	return createContract(workflowDraftShape)
}

/**
 * Wrap a {@link WorkflowDefinition} as an LLM-callable tool — it ADVERTISES the SIMPLE flat
 * authoring shape (`{ name?, steps: [{ name }] }`) as its `parameters` so even a small model can
 * author a complete tree, and its handler EXPANDS / COMPLETES the authored blob, validates it
 * against the STRICT contract, runs it through `runner`, and, when
 * {@link import('./types.js').WorkflowToolOptions.store} is supplied, PERSISTS each executed
 * workflow's final snapshot after the run settles.
 *
 * @remarks
 * A plain `ToolManagerInterface`-compatible tool (`@orkestrel/agent`), reproducing
 * `@orkestrel/workflow`'s former call contract exactly (flat / draft / full authoring forms, the
 * strict soundness gate, the depth/cycle guard). It is ALSO the propagation carrier
 * {@link createAgentFunction} binds onto a wrapped agent's `context.tools`: because a tool
 * handler receives ONLY the model-supplied `args` (no ambient context, no signal), the run's
 * depth + ancestry are CLOSED OVER at bind time via {@link import('./types.js').WorkflowToolOptions},
 * and the handler enforces the SAME depth / cycle guard itself before running the nested
 * workflow at `depth + 1` with the extended ancestry.
 *
 * **Widened authoring surface (additive — the canonical contract + runner stay STRICT and
 * unchanged).** A 2B model reliably CALLS the tool but cannot reliably emit the full four-level
 * nested {@link WorkflowDefinition} (six required `id`/`name` strings, an all-or-nothing tree).
 * So the tool ACCEPTS three authoring forms and converges them on the SAME strict
 * `createWorkflowContract` gate before running (soundness preserved):
 * - the FLAT shape `{ name?, steps: [{ name }] }` — the ADVERTISED `parameters` (the simplest
 *   form, {@link import('./helpers.js').expandSteps}'d into one one-task phase per step);
 * - a nested DRAFT with any `id`/`name` OMITTED — {@link createWorkflowDraftContract}-parsed then
 *   {@link import('./helpers.js').completeDraft}'d (missing ids synthesized positionally);
 * - the full nested {@link WorkflowDefinition} — the advanced escape-hatch, accepted as the draft
 *   super-set.
 *
 * The universal tool-handler contract (AGENTS §14): returns the plain run summary
 * (`{ status, count }`) on success, THROWS a typed `WorkflowError` (`@orkestrel/workflow`) on
 * every failure path — malformed authored args (`TOOL`), or an over-deep / cyclic nested run
 * (`DEPTH`). The `ToolManagerInterface` isolates every throw into the canonical tool result's
 * top-level `error`, so nothing escapes the run. `options.depth` / `options.ancestry` are the
 * propagation carrier across a workflow → agent → workflow chain; `options.store` is this
 * package's ADDITION — the persisted snapshot is retrievable via the store afterwards (a caller
 * restores it through `@orkestrel/workflow`'s own `Workflow.restore` / store-backed factories).
 *
 * @param definition - The workflow the tool runs when called with no authored args
 * @param runner - The `WorkflowRunnerInterface` (`@orkestrel/workflow`) that executes the (nested) workflow
 * @param options - Depth/ancestry bookkeeping plus the optional durable store (see {@link import('./types.js').WorkflowToolOptions})
 * @returns A `ToolInterface` (named {@link import('./constants.js').WORKFLOW_TOOL_NAME}) whose
 *   `parameters` advertise the flat authoring schema
 *
 * @example
 * ```ts
 * import { createWorkflowTool } from '@src/core'
 * import { createWorkflowRunner, createMemoryWorkflowStore } from '@orkestrel/workflow'
 * import { createToolManager } from '@orkestrel/agent'
 *
 * const runner = createWorkflowRunner()
 * const store = createMemoryWorkflowStore()
 * const tool = createWorkflowTool(definition, runner, { store })
 * const tools = createToolManager()
 * tools.add(tool) // authored runs are now persisted to `store` on settle
 * ```
 */
export function createWorkflowTool(
	definition: WorkflowDefinition,
	runner: WorkflowRunnerInterface,
	options?: WorkflowToolOptions,
): ToolInterface {
	const strict = createWorkflowContract()
	const draft = createWorkflowDraftContract()
	const steps: ContractInterface<WorkflowSteps> = createContract(workflowStepsShape)
	const depth = options?.depth ?? 0
	const ancestry = options?.ancestry ?? []
	const store = options?.store
	const parameters = schemaToParameters(steps.schema)
	return createTool({
		name: WORKFLOW_TOOL_NAME,
		description: WORKFLOW_TOOL_DESCRIPTION,
		parameters,
		execute: async (args) => {
			// Branch on the authored args' SHAPE (no ambient context — a tool handler gets only
			// `args`): empty ⇒ the wrapped definition; a `steps` array ⇒ the FLAT form, parsed +
			// expanded; otherwise the nested DRAFT form, parsed + completed. A parse failure leaves
			// `target` undefined ⇒ the strict gate below throws `TOOL`.
			let target: WorkflowDefinition | undefined
			if (Object.keys(args).length === 0) {
				target = definition
			} else if (Array.isArray(args.steps)) {
				const flat = steps.parse(args)
				target = flat === undefined ? undefined : expandSteps(flat)
			} else {
				const parsed = draft.parse(args)
				target = parsed === undefined ? undefined : completeDraft(parsed)
			}
			// The SOUNDNESS gate: whatever authoring form produced `target`, it must satisfy the
			// STRICT canonical contract before it runs — the leniency never reaches the runner.
			if (target === undefined || !strict.is(target)) {
				throw new WorkflowError('TOOL', 'malformed workflow definition', {
					workflow: definition.id,
				})
			}
			if (depth + 1 > MAX_WORKFLOW_DEPTH) {
				throw new WorkflowError(
					'DEPTH',
					`nested workflow exceeds max depth ${MAX_WORKFLOW_DEPTH}`,
					{
						workflow: target.id,
						depth,
						max: MAX_WORKFLOW_DEPTH,
					},
				)
			}
			const tag = workflowTag(target.id)
			if (ancestry.includes(tag)) {
				throw new WorkflowError('DEPTH', `workflow '${target.id}' is already an ancestor (cycle)`, {
					workflow: target.id,
					ancestry: [...ancestry],
				})
			}
			const result = await runner.execute(target)
			if (store !== undefined) await store.set(result.workflow.snapshot())
			return workflowToolSummary(result)
		},
	})
}

/**
 * Build an LLM-callable workspace-editing tool — it ADVERTISES the `operation`-discriminated
 * 13-op union ({@link import('./shapers.js').workspaceToolShape}) as its `parameters`, and its
 * handler PARSES the model-supplied args against that contract and DISPATCHES the matched
 * operation against the manager's ACTIVE workspace (the registry ops drive the manager itself),
 * returning the plain result (throwing a typed `WorkspaceError`, `@orkestrel/agent`, on
 * failure). EITHER drives a caller-supplied {@link WorkspaceToolOptions.manager} directly, OR
 * constructs a fresh `WorkspaceManagerInterface` (`@orkestrel/agent`) over
 * {@link import('./types.js').WorkspaceToolOptions.store} (via `@orkestrel/agent`'s
 * `createWorkspaceManager`); neither given constructs a manager backed by `@orkestrel/agent`'s
 * in-memory store default.
 *
 * @remarks
 * MANAGER-DRIVEN: every edit / read op (read / list / has / search / replace / write / splice /
 * prepend / append / move / remove) targets `manager.active`, so the model edits whichever
 * workspace is active and a host can re-point it (`WorkspaceManagerInterface.switch`) between
 * turns. Two REGISTRY ops make the model self-sufficient: `workspaces` LISTS the registered
 * workspaces (each `{ id, files, active }`) so it can discover an id, and `switch` re-points the
 * active workspace by id (lenient — an unknown id is a no-op reporting `switched: false`, never a
 * throw).
 *
 * NO-ACTIVE RULE (the ergonomic seam): a WRITING op (write / splice / prepend / append / move /
 * remove / replace) run when `manager.active` is `undefined` AUTO-CREATES + activates a default
 * workspace (`manager.add()`) so the model can just start writing; a pure-READ op (read / list /
 * has / search) against no active workspace returns the EMPTY result (`undefined` / `[]` /
 * `false`), never creating one and never throwing.
 *
 * The handler conforms to the universal tool-handler contract (AGENTS §14): it `contract.parse`s
 * the args, THROWS a `TOOL` `WorkspaceError` when no operation arm matched (a malformed / unknown
 * operation), else `switch`es on `op.operation` and RETURNS the plain result — letting a
 * `WorkspaceError` raised by the live workspace (`MODALITY` / `PATTERN` / `RANGE`) PROPAGATE
 * uncaught. The range edit is the FLAT `'splice'` op: its four flat caret integers are
 * reassembled into a `Range` (`@orkestrel/agent`) by `rangeOf` and fed to the workspace's ranged
 * `write`.
 *
 * @param options - `manager` (drive directly) OR `store` (build a manager over it); neither ⇒
 *   an in-memory-backed manager (see {@link import('./types.js').WorkspaceToolOptions})
 * @returns A `ToolInterface` (named {@link import('./constants.js').WORKSPACE_TOOL_NAME} by default)
 *
 * @example
 * ```ts
 * import { createWorkspaceTool } from '@src/core'
 * import { createToolManager } from '@orkestrel/agent'
 *
 * const tool = createWorkspaceTool() // in-memory workspace, no persistence
 * const tools = createToolManager()
 * tools.add(tool)
 * ```
 */
export function createWorkspaceTool(options?: WorkspaceToolOptions): ToolInterface {
	const manager: WorkspaceManagerInterface =
		options?.manager ??
		createWorkspaceManager(options?.store === undefined ? undefined : { store: options.store })
	const contract: ContractInterface<WorkspaceOperation> = createContract(workspaceToolShape)
	const parameters = schemaToParameters(contract.schema)
	return createTool({
		name: options?.name ?? WORKSPACE_TOOL_NAME,
		description: options?.description ?? WORKSPACE_TOOL_DESCRIPTION,
		parameters,
		execute: (args) => {
			const op = contract.parse(args)
			if (op === undefined) {
				throw new WorkspaceError('TOOL', `unknown or malformed operation`, { args })
			}
			// Registry ops act on the MANAGER, not a workspace — handle them first.
			if (op.operation === 'workspaces') {
				const activeId = manager.active?.id
				return manager.workspaces().map((workspace) => ({
					id: workspace.id,
					files: workspace.count,
					active: workspace.id === activeId,
				}))
			}
			if (op.operation === 'switch') {
				const switched = manager.switch(op.id)
				// Lenient: an unknown id leaves `active` unchanged and reports `switched: false`.
				return switched === undefined
					? { id: op.id, switched: false }
					: { id: switched.id, switched: true, files: switched.count }
			}
			// Edit / read ops target the ACTIVE workspace. A WRITING op ensures a target — auto-creating
			// + activating a default workspace when none is active (the no-active ergonomic seam) — while
			// a pure-READ op returns the empty result against no active workspace rather than creating one.
			const active = manager.active
			switch (op.operation) {
				case 'read':
					return active?.read(op.path)
				case 'list':
					return (active?.files() ?? []).map((file) => ({
						path: file.path,
						state: file.state,
						size: file.size,
						lines: file.lines,
						kind: isText(file.content) ? 'text' : 'binary',
					}))
				case 'has':
					return active?.has(op.path) ?? false
				case 'search':
					return (
						active?.search(op.query, { regex: op.regex, exact: op.exact, limit: op.limit }) ?? []
					)
				case 'replace': {
					const workspace = active ?? manager.add()
					return workspace.replace(op.query, op.replacement, {
						regex: op.regex,
						exact: op.exact,
						limit: op.limit,
					})
				}
				case 'write': {
					const workspace = active ?? manager.add()
					workspace.write(op.path, op.content)
					return { path: op.path, state: workspace.file(op.path)?.state }
				}
				case 'splice': {
					const workspace = active ?? manager.add()
					workspace.write(
						op.path,
						op.content,
						rangeOf(op.fromLine, op.fromColumn, op.toLine, op.toColumn),
					)
					return { path: op.path, state: workspace.file(op.path)?.state }
				}
				case 'prepend': {
					const workspace = active ?? manager.add()
					workspace.prepend(op.path, op.content)
					return { path: op.path, state: workspace.file(op.path)?.state }
				}
				case 'append': {
					const workspace = active ?? manager.add()
					workspace.append(op.path, op.content)
					return { path: op.path, state: workspace.file(op.path)?.state }
				}
				case 'move': {
					const workspace = active ?? manager.add()
					return { from: op.from, to: op.to, moved: workspace.move(op.from, op.to) }
				}
				case 'remove': {
					const workspace = active ?? manager.add()
					return { path: op.path, removed: workspace.remove(op.path) }
				}
			}
		},
	})
}

/**
 * Build an LLM-callable sub-agent delegation tool — resolves a live, seeded `AgentInterface`
 * from `registry` and runs it to completion for ONE delegated `task`.
 *
 * @remarks
 * The universal tool-handler contract (AGENTS §14): validates the call args against
 * {@link import('./shapers.js').agentToolShape}, assembles an `AgentJobInput` (`task` seeds the
 * sub-agent's conversation as a single `user` message; `provider` / `tools` / `system` fall
 * back to the tool's own {@link import('./types.js').AgentToolOptions} defaults), rehydrates the sub-agent via
 * `registry.build`, runs it with `agent.generate()`, and returns the settled
 * `AgentResult.content` string (the sub-agent's final text). A missing / unresolvable `provider`, or a malformed call, THROWS a typed `TOOL`
 * {@link import('./errors.js').AgentToolError}; a delegation that would exceed
 * {@link import('./constants.js').AGENT_TOOL_DEPTH}, or re-enter an already-delegated agent (a
 * cycle), THROWS a typed `DEPTH` {@link import('./errors.js').AgentToolError} — both isolated
 * by the `ToolManagerInterface` into the canonical tool result's top-level `error`.
 *
 * `AgentInterface` (`@orkestrel/agent`) exposes no teardown method — a bound sub-agent's
 * lifetime is the single `generate()` call this handler awaits; there is nothing to release
 * afterwards (unlike a store-backed resource, its state lives entirely in the resolved
 * `AgentContextInterface`, owned by the caller's registry).
 *
 * @param registry - The `AgentRegistryInterface` a delegated job resolves against (providers,
 *   tools, authorities, schedulers, and the `build` rehydration seam)
 * @param options - Delegation defaults, depth/ancestry bookkeeping, and advertised overrides
 *   (see {@link import('./types.js').AgentToolOptions})
 * @returns A `ToolInterface` (named {@link import('./constants.js').AGENT_TOOL_NAME} by default)
 *
 * @example
 * ```ts
 * import { createAgentTool } from '@src/core'
 * import { createAgentRegistry, createToolManager } from '@orkestrel/agent'
 *
 * const registry = createAgentRegistry({ providers: { openai: myProvider } })
 * const tool = createAgentTool(registry, { provider: 'openai' })
 * const tools = createToolManager()
 * tools.add(tool) // a model can now delegate a task to a sub-agent
 * ```
 */
export function createAgentTool(
	registry: AgentRegistryInterface,
	options?: AgentToolOptions,
): ToolInterface {
	const contract = createContract(agentToolShape)
	const parameters = schemaToParameters(contract.schema)
	const depth = options?.depth ?? 0
	const ancestry = options?.ancestry ?? []
	return createTool({
		name: options?.name ?? AGENT_TOOL_NAME,
		description: options?.description ?? AGENT_TOOL_DESCRIPTION,
		parameters,
		execute: async (args) => {
			const call = contract.parse(args)
			if (call === undefined) {
				throw new AgentToolError('TOOL', 'malformed agent-delegation call', { args })
			}
			const provider = call.provider ?? options?.provider
			if (provider === undefined) {
				throw new AgentToolError('TOOL', 'no provider resolved for the delegated agent', {
					task: call.task,
				})
			}
			if (depth + 1 > AGENT_TOOL_DEPTH) {
				throw new AgentToolError(
					'DEPTH',
					`delegation exceeds max agent depth ${AGENT_TOOL_DEPTH}`,
					{
						provider,
						depth,
						max: AGENT_TOOL_DEPTH,
					},
				)
			}
			const tag = agentTag(provider)
			if (ancestry.includes(tag)) {
				throw new AgentToolError('DEPTH', `agent '${provider}' is already an ancestor (cycle)`, {
					provider,
					ancestry: [...ancestry],
				})
			}
			const tools = call.tools ?? options?.tools
			const system = call.system ?? options?.system
			const agent = registry.build({
				provider,
				messages: [{ role: 'user', content: call.task }],
				...(system === undefined ? {} : { system }),
				...(tools === undefined ? {} : { tools }),
			})
			const result = await agent.generate()
			return result.content
		},
	})
}
