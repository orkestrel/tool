# Tool

> Concrete, LLM-callable **tools** for the `@orkestrel` line — workflow authoring, workspace editing, and sub-agent delegation — over [`@orkestrel/agent`](agent.md)'s `ToolInterface` / `createTool` runtime, with pluggable stores. The runtime supplies the CALL SHAPE (`Tool`, `ToolManager`, the `{ id, name, value }` / `{ id, name, error }` envelope); this package supplies the CONCRETE BEHAVIOR — one factory per tool, each a `handler` that parses model-supplied args against a compiled [contract](contract.md), dispatches, and either returns a plain value or throws a typed error, exactly the shape the runtime's `ToolManagerInterface.execute` isolates.

`createWorkflowTool` and `createWorkspaceTool` own their FULL handler logic (ported byte-faithfully from `@orkestrel/workflow` / `@orkestrel/agent` ahead of the upstream cleanup that drops the authoring surface from those packages — this package is now the defining home) and layer a pluggable `store` slot on top; `createAgentTool` is net-new — sub-agent delegation over an `AgentRegistryInterface`, deliberately storeless (persistence, if any, rides the registry's own configuration). The two workflow-function adapters `createToolFunction` / `createAgentFunction` compose a `@orkestrel/agent` tool or a live agent into a workflow's `functions` registry; the authoring umbrella (`WorkflowSteps` / `WorkflowDraft` shapes, `createWorkflowDraftContract`, `expandSteps` / `completeDraft`, `workflowToolSummary`, `MAX_WORKFLOW_DEPTH`) is what lets a small model author a whole tree in one call.

Source: [`src/core`](../../src/core). Surfaced through the `@src/core` barrel.

## Surface

### Factories

| API                           | Kind     | Summary                                                                                                                                                               |
| ----------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createToolFunction`          | function | Wrap a registered tool as a `WorkflowFunction` — the OPT-IN adapter for a `function`-form task that runs a `@orkestrel/agent` tool BY NAME.                           |
| `createAgentFunction`         | function | Wrap a live `AgentInterface` as a `WorkflowFunction`, folding the nested-workflow depth/cycle guard into its own closure.                                             |
| `createWorkflowDraftContract` | function | Compile the LENIENT DRAFT `ContractInterface` — like the strict `createWorkflowContract` but `id`/`name` optional at all three levels.                                |
| `createWorkflowTool`          | function | Wrap a `WorkflowDefinition` as an LLM-callable `ToolInterface` advertising the FLAT authoring shape, with an optional pluggable `WorkflowStoreInterface`.             |
| `createWorkspaceTool`         | function | Build the 13-operation workspace-editing `ToolInterface`, driving a caller `WorkspaceManagerInterface` OR a manager built over a pluggable `WorkspaceStoreInterface`. |
| `createAgentTool`             | function | Build the sub-agent delegation `ToolInterface` — resolves + runs one seeded agent via an `AgentRegistryInterface`, depth/cycle guarded.                               |

### Errors

| API                | Kind     | Summary                                                                                                                                                                               |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentToolError`   | class    | Carries an `AgentToolErrorCode` (`TOOL` / `DEPTH`) + an optional `context` — `createAgentTool`'s own typed error (net-new, no `@orkestrel/agent` class fits a pre-run guard failure). |
| `isAgentToolError` | function | Narrow an unknown caught value to an `AgentToolError`.                                                                                                                                |

### Helpers

Pure, side-effect-free, exhaustively unit-tested (AGENTS §4.3 / §14) — the lenient-authoring synthesis path and the ancestry tags shared by both delegating tools.

| API                   | Kind     | Behavior                                                                                                                                |
| --------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `workflowTag`         | function | The ancestry identifier of a workflow in a run chain — `workflow:<id>`.                                                                 |
| `agentTag`            | function | The ancestry identifier of an agent in a run chain — `agent:<name>`.                                                                    |
| `workflowToolSummary` | function | Build the plain success value `createWorkflowTool` returns on a completed run — `{ status, count }`.                                    |
| `completeDraft`       | function | Complete a `WorkflowDraft` into a strict `WorkflowDefinition` — synthesize missing ids positionally, default missing names to their id. |
| `completePhaseDraft`  | function | Complete one `PhaseDraft` into a strict phase definition — the per-phase step of `completeDraft`.                                       |
| `completeTaskDraft`   | function | Complete one `TaskDraft` into a strict task definition — the per-task leaf step of `completeDraft`.                                     |
| `expandSteps`         | function | Expand a flat `WorkflowSteps` blob into a strict `WorkflowDefinition` — each step becomes a one-task phase, in order.                   |

### Shapes

The shape VALUES each `create*Tool` factory (and `createWorkflowDraftContract`) compiles into the lockstep guard / parser / JSON Schema outputs (AGENTS §14); `agentToolShape` agrees with the hand-written `AgentToolArguments`, the source of truth.

| API                  | Kind  | Summary                                                                                                                                            |
| -------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentToolShape`     | const | The shape of `AgentToolArguments` — `createAgentTool`'s advertised `parameters` (`task` required, `provider`/`tools`/`system` optional overrides). |
| `taskDraftShape`     | const | The DRAFT task shape — like a strict task shape but `id`/`name` optional.                                                                          |
| `phaseDraftShape`    | const | The DRAFT phase shape — `id`/`name` optional, holding `taskDraftShape` tasks.                                                                      |
| `workflowDraftShape` | const | The DRAFT workflow shape `createWorkflowDraftContract` compiles — `id`/`name` optional at all three levels.                                        |
| `stepShape`          | const | The flat STEP shape — `{ name }`, the building block of `workflowStepsShape`.                                                                      |
| `workflowStepsShape` | const | The FLAT shape `createWorkflowTool` advertises as its `parameters` — `{ name?, steps: [{ name }] }`.                                               |
| `workspaceToolShape` | const | The 13-arm `operation`-discriminated union `createWorkspaceTool` advertises as its `parameters`.                                                   |

### Constants

| Constant                       | Kind  | Value                                                                                                                            |
| ------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| `AGENT_TOOL_NAME`              | const | The name (`'agent'`) `createAgentTool` advertises by default.                                                                    |
| `AGENT_TOOL_DEPTH`             | const | The maximum sub-agent delegation nesting depth (`8`) — deliberately a SEPARATE constant from `MAX_WORKFLOW_DEPTH`.               |
| `AGENT_TOOL_DESCRIPTION`       | const | The multi-line description `createAgentTool` advertises — `task` required, `provider`/`tools`/`system` per-call overrides.       |
| `MAX_WORKFLOW_DEPTH`           | const | The maximum nesting depth a workflow → agent → workflow chain may reach — owned here now (ported from `@orkestrel/workflow`).    |
| `WORKFLOW_TOOL_NAME`           | const | The name (`'workflow'`) `createWorkflowTool` advertises by default, and the key `createAgentFunction` binds a nested tool under. |
| `WORKFLOW_TOOL_FLAT_EXAMPLE`   | const | A complete FLAT authoring example (`{ name, steps: [{ name }] }`) embedded verbatim in `WORKFLOW_TOOL_DESCRIPTION`.              |
| `WORKFLOW_TOOL_NESTED_EXAMPLE` | const | A minimal NESTED authoring example (a full `WorkflowDefinition`) — the advanced-form example in the description.                 |
| `WORKFLOW_TOOL_DESCRIPTION`    | const | The multi-line description `createWorkflowTool` advertises — the flat form (primary) + the nested form (advanced).               |
| `WORKSPACE_TOOL_NAME`          | const | The name (`'workspace'`) `createWorkspaceTool` advertises by default.                                                            |
| `WORKSPACE_TOOL_EXAMPLE`       | const | A valid `WorkspaceOperation` (a `'write'` op) embedded verbatim in `WORKSPACE_TOOL_DESCRIPTION`.                                 |
| `WORKSPACE_TOOL_DESCRIPTION`   | const | The multi-line description `createWorkspaceTool` advertises — every operation's flat fields + a worked example.                  |

### Types

| Type                   | Kind      | Shape                                                                                                                                                                                                                   |
| ---------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskDraft`            | interface | `{ id?, name?, description?, run?, retries?, timeout? }` — a `TaskDefinition` (`@orkestrel/workflow`) with OPTIONAL id/name.                                                                                            |
| `PhaseDraft`           | interface | `{ id?, name?, description?, tasks, concurrency?, bail? }` — a `PhaseDefinition` with OPTIONAL id/name + `TaskDraft` tasks.                                                                                             |
| `WorkflowDraft`        | interface | `{ id?, name?, description?, phases, bail? }` — a `WorkflowDefinition` with OPTIONAL id/name at all three levels.                                                                                                       |
| `WorkflowStep`         | interface | `{ name }` — one flat step; `name` is a REGISTERED behavior name (becomes the task's `run`, not a human label).                                                                                                         |
| `WorkflowSteps`        | interface | `{ name?, steps }` — the FLAT authoring blob `createWorkflowTool` advertises; each step → a one-task phase via `expandSteps`.                                                                                           |
| `AgentFunctionOptions` | interface | `{ runner?, depth?, ancestry? }` — options for `createAgentFunction`: the OPT-IN nested-workflow-tool binding + depth/cycle bookkeeping.                                                                                |
| `WorkflowToolOptions`  | interface | `{ depth?, ancestry?, store? }` — the depth + ancestry a nested run is bound at, plus the optional durable `WorkflowStoreInterface`.                                                                                    |
| `WorkspaceToolOptions` | interface | `{ name?, description?, manager?, store? }` — a caller-built `WorkspaceManagerInterface` to drive directly, OR a `WorkspaceStoreInterface` to build one over.                                                           |
| `WorkspaceOperation`   | type      | The 13-arm `operation`-discriminated union `createWorkspaceTool` dispatches — `read` / `list` / `has` / `search` / `replace` / `write` / `splice` / `prepend` / `append` / `move` / `remove` / `workspaces` / `switch`. |
| `AgentToolOptions`     | interface | `{ name?, description?, provider?, tools?, system?, depth?, ancestry? }` — `createAgentTool`'s delegation defaults + nesting bookkeeping.                                                                               |
| `AgentToolArguments`   | interface | `{ task, provider?, tools?, system? }` — the flat call args `createAgentTool` accepts.                                                                                                                                  |
| `AgentToolErrorCode`   | type      | `'TOOL' \| 'DEPTH'` — the machine-readable code an `AgentToolError` carries.                                                                                                                                            |

## Methods

None of this package's exports are behavioral interfaces with their own implementing class. Every `create*Tool` factory returns a plain `ToolInterface` (`@orkestrel/agent`'s own type — its method surface is documented in [`agent.md`](agent.md), not re-documented here), and `createAgentFunction` / `createToolFunction` return a plain `WorkflowFunction` (`@orkestrel/workflow`'s own type — see [`workflow.md`](workflow.md)). The `WorkspaceManagerInterface` / `WorkflowRunnerInterface` / `AgentRegistryInterface` a caller supplies are likewise defined and documented upstream.

## Contract

These invariants hold across `src/core` ↔ `tool.md`:

1. **DOC ↔ SOURCE bijection.** Every `function` / `class` / `const` / `interface` / `type` row in the `## Surface` tables is a real export of `src/core`, and every export appears as a Surface row — exhaustive, both directions (AGENTS §22).

2. **One tool = one behavior; the runtime supplies the envelope, this package supplies the handler.** Each `create*Tool` factory returns a plain `ToolInterface` (`@orkestrel/agent`) — `name` / `description` / `parameters` / `execute`. The handler PARSES the model-supplied `args` against a compiled [contract](contract.md), dispatches, and either RETURNS a plain value on success or THROWS a typed error on every failure path (AGENTS §14's universal tool-handler contract) — it never builds a `ToolResult` itself. The `ToolManagerInterface.execute` (`@orkestrel/agent`) performs the ONE canonical wrap — `{ id, name, value }` on a return, `{ id, name, error }` on a throw, ISOLATED so nothing escapes the run — so a failure appears EXACTLY ONCE, identically, over both the agent loop and MCP.

3. **Contract-compiled schemas throughout.** Every advertised `parameters` is `schemaToParameters(contract.schema)` off a `createContract`-compiled shape (`workflowStepsShape` / `workflowDraftShape` / `workspaceToolShape` / `agentToolShape`) — never a hand-written JSON Schema — so the guard / parser / schema the handler validates against can never drift from what the tool advertises.

4. **Every delegating tool guards depth + cycle before it acts.** `createWorkflowTool` (a nested workflow run), `createAgentFunction` (an agent authoring a nested workflow through its bound tool), and `createAgentTool` (sub-agent delegation) each carry a `depth` + `ancestry` pair (`WorkflowToolOptions` / `AgentFunctionOptions` / `AgentToolOptions`), CLOSED OVER at bind/construction time (a tool handler receives only the model-supplied `args`, no ambient context — so the run's position in a workflow → agent → workflow or agent → agent chain cannot be threaded through a call). Before acting, the handler REJECTS with a typed `DEPTH` error when `depth + 1` would exceed the bound (`MAX_WORKFLOW_DEPTH` for the workflow chain, `AGENT_TOOL_DEPTH` for the agent-delegation chain — deliberately separate constants, same value by convention only) OR when the target (`workflowTag(id)` / `agentTag(name)`) is already present in `ancestry` (a re-entry cycle) — never runs the nested work in either case.

5. **`createWorkflowTool` widens the authoring surface additively; the strict contract stays the soundness gate.** It advertises the SIMPLE flat shape (`{ name?, steps: [{ name }] }`) as its `parameters` so a small model can author a whole tree in one call, but its handler ACCEPTS three forms — empty args (the wrapped `definition`), a `steps` array (the flat form, `expandSteps`'d), or a nested draft/full definition (`createWorkflowDraftContract`-parsed + `completeDraft`'d, or accepted as-is when already strict) — and EVERY path converges on the byte-for-byte-unchanged `createWorkflowContract().is` gate before it runs. A blob that fails to parse, expand, or complete, or whose result fails that strict gate, THROWS a `TOOL` `WorkflowError` (`@orkestrel/workflow`); the leniency never reaches the runner.

6. **`createWorkflowTool`'s store persists on settle; omitted means no persistence.** When `options.store` (a `WorkflowStoreInterface`) is supplied, the handler `await`s `store.set(result.workflow.snapshot())` once the run SETTLES (after `runner.execute` resolves, before the handler returns) — the executed run's final snapshot is retrievable / restorable afterwards through the SAME store a caller passed in. Omitted, the handler persists nothing; the run's outcome exists only in the returned summary.

7. **`createWorkspaceTool` is manager-driven, with a no-active ergonomic seam.** `options.manager` (drive directly) takes priority over `options.store` (build a fresh manager over it via `@orkestrel/agent`'s `createWorkspaceManager`); neither given constructs a manager over `@orkestrel/agent`'s in-memory default. NOTE the deliberate `store` divergence from invariant 6: the workspace tool's `store` only BACKS the constructed manager's `open` / `save` — the tool's edits are NOT auto-persisted (durability requires an explicit caller `save`), whereas the workflow tool's `store` persists each executed snapshot on settle. Every edit / read arm targets `manager.active` — never a specific workspace by id directly — so a host repoints which workspace the model edits via the two REGISTRY arms (`workspaces` lists them, `switch` re-points `active`, lenient on an unknown id). A WRITING arm (write / splice / prepend / append / move / remove / replace) run with no active workspace AUTO-CREATES + activates one (`manager.add()`); a pure-READ arm (read / list / has / search) against no active workspace returns the EMPTY result, never creating one.

8. **`createAgentTool` is deliberately storeless.** Unlike the workflow / workspace tools, `AgentToolOptions` carries NO `store` slot: `AgentRegistryInterface.build` (`@orkestrel/agent`) accepts only an `AgentJobInput` + an optional cancel `signal` — there is no public seam to thread a `ConversationStoreInterface` through one delegated build call. Persistence for a delegated sub-agent, if any, rides the CALLER'S registry configuration (a registry-level store already covers every agent it builds, including ones built through this tool) — this package adds no persistence concern of its own for delegation.

9. **A delegated sub-agent's lifecycle is a single `generate()` call.** `createAgentTool`'s handler resolves a live agent via `registry.build`, awaits ONE `agent.generate()`, and returns its settled `content` — `AgentInterface` (`@orkestrel/agent`) exposes no teardown method, so there is nothing to release afterwards; the agent's state lives entirely in the resolved `AgentContextInterface`, owned by the caller's registry.

10. **Provider-agnostic delegation.** `createAgentTool` never imports or references a concrete `ProviderInterface` implementation — `options.provider` / a per-call `call.provider` is a REGISTRY KEY resolved by `registry.build`, so swapping the provider behind that key changes nothing about the tool. A missing / unresolvable provider (neither the call nor the tool's own default supplies one) THROWS a `TOOL` `AgentToolError` before any agent is built.

11. **`AgentToolError` mirrors `WorkflowError`'s exact shape, kept distinct per package.** It carries a machine-readable `code` (`AgentToolErrorCode` — `TOOL` / `DEPTH`) + an optional `context` bag, thrown on every `createAgentTool` failure path — never a `{ error }` return (AGENTS §14). `@orkestrel/workflow`'s `WorkflowError` and `@orkestrel/agent`'s `WorkspaceError` already cover the workflow tool's and workspace tool's failure paths respectively and are thrown as-is, never duplicated.

12. **The workflow-function adapters are OPT-IN, composed into the caller's own registry.** `createToolFunction(tools, name)` and `createAgentFunction(agent, options?)` each return a plain `WorkflowFunction` (`@orkestrel/workflow`) — the pure `WorkflowRunner` engine carries no knowledge of tools or agents itself; a caller composes either adapter into its own `WorkflowOptions.functions` registry like any other behavior (`{ publish: createToolFunction(tools, 'publish') }`). `createToolFunction`'s wrapped `ToolManagerInterface.execute` never throws (a handler throw is isolated into `result.error`), so the adapter RE-THROWS a plain `Error` carrying that message as `cause` when `result.error` is set — surfacing it as a task failure that honours `bail`. `createAgentFunction` folds the task's cancellation into the wrapped agent's run (an already-aborted `controller.signal` cancels up front; otherwise a one-shot listener fires `agent.abort` on the task's own cancellation) and, when `options.runner` is supplied, BINDS a depth/cycle-aware `createWorkflowTool` onto the agent's `context.tools` under `WORKFLOW_TOOL_NAME` — the propagation seam letting the wrapped agent author + run a NESTED workflow.

## Patterns

These patterns follow the arc — author + run a workflow through the tool; persist its snapshot; drive a workspace through the tool; delegate to a sub-agent; compose the adapters into a workflow's own registry.

### Authoring + running a workflow through the tool, via a real `ToolManager`

```ts
import { createWorkflowTool } from '@src/core'
import { createToolManager } from '@orkestrel/agent'
import { createWorkflowRunner } from '@orkestrel/workflow'
import type { WorkflowDefinition } from '@orkestrel/workflow'

const definition: WorkflowDefinition = { id: 'release', name: 'Release', phases: [] }
const runner = createWorkflowRunner()
const tool = createWorkflowTool(definition, runner)

const tools = createToolManager()
tools.add(tool)

// A small model authors the SIMPLE flat shape — no ids/names required.
const result = await tools.execute({
	id: 'call-1',
	name: 'workflow',
	arguments: { name: 'release', steps: [{ name: 'compile' }, { name: 'publish' }] },
})
result.value // { status: 'completed', count: 2 } — the single-level envelope; no nested { id, name, value }
```

### Plugging a `WorkflowStoreInterface` and retrieving the persisted snapshot

```ts
import { createWorkflowTool } from '@src/core'
import {
	createMemoryWorkflowStore,
	createWorkflowRunner,
	restoreWorkflow,
} from '@orkestrel/workflow'
import type { WorkflowDefinition } from '@orkestrel/workflow'

const definition: WorkflowDefinition = { id: 'ingest', name: 'Ingest', phases: [] }
const store = createMemoryWorkflowStore()
const runner = createWorkflowRunner()
const tool = createWorkflowTool(definition, runner, { store })

await tool.execute({}) // empty args ⇒ run the wrapped `definition` ('ingest') — persisted on settle
const snapshot = await store.get('ingest')
const restored = snapshot === undefined ? undefined : restoreWorkflow(snapshot)
restored?.status // 'completed' — the persisted run, rebuilt from its own snapshot
```

### Driving the workspace tool with a plugged store

```ts
import { createWorkspaceTool } from '@src/core'
import { createMemoryWorkspaceStore } from '@orkestrel/agent'
import { createToolManager } from '@orkestrel/agent'

const store = createMemoryWorkspaceStore()
const tool = createWorkspaceTool({ store }) // builds a fresh manager over `store`

const tools = createToolManager()
tools.add(tool)

await tools.execute({
	id: 'w1',
	name: 'workspace',
	arguments: { operation: 'write', path: 'notes.txt', content: 'hello' },
})
const read = await tools.execute({
	id: 'w2',
	name: 'workspace',
	arguments: { operation: 'read', path: 'notes.txt' },
})
read.value // 'hello'
```

### Delegating to a sub-agent through the agent tool

```ts
import { createAgentTool } from '@src/core'
import { createAgentRegistry, createToolManager } from '@orkestrel/agent'

declare const registry: ReturnType<typeof createAgentRegistry> // seeded with a `providers` pool

const tool = createAgentTool(registry, { provider: 'openai' })
const tools = createToolManager()
tools.add(tool)

const result = await tools.execute({
	id: 'delegate-1',
	name: 'agent',
	arguments: { task: 'Summarize the attached notes in three bullet points.' },
})
result.value // the sub-agent's settled `AgentResult.content`
```

### Composing `createToolFunction` / `createAgentFunction` into a workflow's `functions` registry

```ts
import { createAgentFunction, createToolFunction } from '@src/core'
import { createToolManager } from '@orkestrel/agent'
import { createWorkflowRunner } from '@orkestrel/workflow'
import type { WorkflowDefinition } from '@orkestrel/workflow'

declare const publishTool: Parameters<ReturnType<typeof createToolManager>['add']>[0]
declare const reviewAgent: Parameters<typeof createAgentFunction>[0]

const tools = createToolManager()
tools.add(publishTool)

const definition: WorkflowDefinition = {
	id: 'ship',
	name: 'Ship',
	phases: [
		{ id: 'review', name: 'Review', tasks: [{ id: 'r', name: 'Review', run: 'review' }] },
		{ id: 'publish', name: 'Publish', tasks: [{ id: 'p', name: 'Publish', run: 'publish' }] },
	],
}
const runner = createWorkflowRunner()
await runner.execute(definition, {
	functions: {
		review: createAgentFunction(reviewAgent), // OPT-IN: wraps a live agent
		publish: createToolFunction(tools, 'publish'), // OPT-IN: wraps a registered tool by name
	},
})
```

### The lenient-authoring helpers, standalone

```ts
import {
	agentTag,
	completeDraft,
	completePhaseDraft,
	completeTaskDraft,
	expandSteps,
	workflowTag,
	workflowToolSummary,
} from '@src/core'

workflowTag('release') // 'workflow:release'
agentTag('reviewer') // 'agent:reviewer'

completeTaskDraft({ run: 'compile' }, 'phase-0', 0) // { id: 'phase-0-task-0', name: 'phase-0-task-0', run: 'compile' }
completePhaseDraft({ tasks: [{ run: 'compile' }] }, 0) // { id: 'phase-0', name: 'phase-0', tasks: [...] }
completeDraft({ phases: [{ tasks: [{ run: 'compile' }] }] }) // a complete WorkflowDefinition, ids/names filled positionally

expandSteps({ steps: [{ name: 'compile' }] }) // one one-task phase whose task's `run` is 'compile'

// workflowToolSummary reduces a settled WorkflowResult to the tool's plain success value:
declare const result: Parameters<typeof workflowToolSummary>[0]
workflowToolSummary(result) // { status: result.status, count: result.results.length }
```

### Recovering a typed `AgentToolError`

```ts
import { AgentToolError, isAgentToolError } from '@src/core'

try {
	throw new AgentToolError('TOOL', 'task is required')
} catch (error) {
	if (isAgentToolError(error)) console.log(error.code) // 'TOOL'
}
```

## Tests

- [`tests/guides/src/parity.test.ts`](../../tests/guides/src/parity.test.ts) — the `## Surface` ↔ `src/core` bijection (value + type exports), and this guide's `## Patterns` fences resolving to real exports with resolving imports.
- [`tests/src/core/factories.test.ts`](../../tests/src/core/factories.test.ts) — every factory returning a working instance / value: `createToolFunction` running a registered tool and re-throwing a failing tool's error with the original message as `cause`; `createAgentFunction` running a live (scripted) agent, folding task cancellation into `agent.abort`, and — when `options.runner` is supplied — binding a depth/cycle-aware `createWorkflowTool` onto the agent's `context.tools` under `WORKFLOW_TOOL_NAME`, plus its own `DEPTH` guard rejecting an over-deep / cyclic call before running the agent; `createWorkflowDraftContract` round-tripping a lenient draft (`id`/`name` optional, an explicit empty `id` still rejected); `createWorkflowTool` end to end through a REAL `createToolManager` — the flat shape, an ids-omitted draft, and the full nested form all converging on `{ status, count }`, a malformed blob throwing `TOOL`, an over-deep / cyclic nested run throwing `DEPTH`, and (with `options.store` supplied) the settled run's snapshot landing in the store; `createWorkspaceTool` driven both `manager`-first and `store`-first, one case per operation arm (incl. the no-active auto-create / empty-read rule and the `workspaces` / `switch` registry arms), and its `WorkspaceError` propagation (`MODALITY` / `PATTERN` / `RANGE` uncaught, `TOOL` on a malformed op); `createAgentTool` resolving a seeded sub-agent via a (scripted) `AgentRegistryInterface`, returning its settled content, its `TOOL` failure paths (malformed call, unresolved provider), and its `DEPTH` guard (over-depth, a cyclic re-entrant provider).
- [`tests/src/core/helpers.test.ts`](../../tests/src/core/helpers.test.ts) — `workflowTag` / `agentTag`'s namespaced tags; `workflowToolSummary`'s plain `{ status, count }` reduction; the lenient-authoring synthesis `completeDraft` / `completePhaseDraft` / `completeTaskDraft` (positional ids, name defaulting to id, a provided id/name preserved, per-phase `bail` + per-task `retries`/`timeout` carried over) and `expandSteps` (one one-task phase per step, a step's `name` → the task's `run`), each yielding a tree the STRICT `createWorkflowContract` accepts.
- [`tests/src/core/shapers.test.ts`](../../tests/src/core/shapers.test.ts) — `agentToolShape` agreeing with `AgentToolArguments` (`task` required, `provider`/`tools`/`system` optional); the draft shapes (`workflowDraftShape` / `phaseDraftShape` / `taskDraftShape`); `stepShape` / `workflowStepsShape`; and `workspaceToolShape` accepting a valid sample of each of the 13 operation arms and rejecting malformed input.
- [`tests/src/core/errors.test.ts`](../../tests/src/core/errors.test.ts) — `AgentToolError` carrying its `code` + optional `context`, and `isAgentToolError` narrowing a caught value (accepting a real instance, rejecting a plain `Error` / non-error value).

## See also

- [`agent.md`](agent.md) — the `ToolInterface` / `ToolManager` runtime every tool here plugs into, the `WorkspaceManagerInterface` / `WorkspaceStoreInterface` the workspace tool drives, and the `AgentRegistryInterface` / `AgentInterface` the agent tool and `createAgentFunction` resolve and run.
- [`workflow.md`](workflow.md) — the `WorkflowDefinition` / `WorkflowRunnerInterface` / `WorkflowStoreInterface` / `WorkflowFunction` primitives the workflow-authoring tool and the two adapters wrap; `WorkflowError` is thrown as-is by `createWorkflowTool` / `createAgentFunction`.
- [`contract.md`](contract.md) — the shape DSL (`createContract`, `objectShape` / `unionShape` / …) every advertised `parameters` compiles through, and `schemaToParameters`.
- [`AGENTS.md`](../../AGENTS.md) — the rules; §14 the universal tool-handler contract + totality, §22 documentation-as-contracts.
- [`README.md`](../README.md) — the guides index.
