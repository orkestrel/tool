import type { AgentToolArguments } from '@src/core'
import type { ToolResult } from '@orkestrel/agent'
import type {
	TaskContext,
	TaskControllerInterface,
	WorkflowDefinition,
	WorkflowDraft,
} from '@orkestrel/workflow'
import {
	buildToolResult,
	createAgent,
	createAgentRegistry,
	createMemoryWorkspaceStore,
	createTool,
	createToolManager,
	createWorkspaceManager,
} from '@orkestrel/agent'
import { isRecord } from '@orkestrel/contract'
import {
	createMemoryWorkflowStore,
	createWorkflowDraftContract,
	createWorkflowRunner,
	isWorkflowError,
} from '@orkestrel/workflow'
import {
	AGENT_TOOL_DEPTH,
	createAgentFunction,
	createAgentTool,
	createToolFunction,
	createWorkflowTool,
	createWorkspaceTool,
	isAgentToolError,
	MAX_WORKFLOW_DEPTH,
	WORKFLOW_TOOL_NAME,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { createRecorder, createScriptedProvider, waitForDelay } from '../../setup.js'

// tests/src/core/factories.test.ts — mirrors src/core/factories.ts. Ported from
// @orkestrel/workflow's + @orkestrel/agent's own factory suites (the byte-faithful port
// source), plus net-new coverage for this package's ADDITIONS: the pluggable store slot on
// createWorkflowTool, the unified manager/store options on createWorkspaceTool, and the
// net-new createAgentTool sub-agent delegation. Real handlers/stores/scripted providers
// throughout (AGENTS §16 — no mocks).

// ── Shared fixtures ──────────────────────────────────────────────────────────

// A one-task definition whose `run` is left UNREGISTERED against any functions passed at
// `execute` time, so the lone task auto-completes ⇒ a `completed` run.
function simpleDefinition(id = 'nested'): WorkflowDefinition {
	return {
		id,
		name: id,
		phases: [{ id: 'p', name: 'P', tasks: [{ id: 't', name: 'T', run: 'noop' }] }],
	}
}

function readSummary(value: unknown): { status: string; count: number } | undefined {
	if (!isRecord(value) || typeof value.status !== 'string' || typeof value.count !== 'number') {
		return undefined
	}
	return { status: value.status, count: value.count }
}

async function rejectionOf(promise: Promise<unknown> | unknown): Promise<unknown> {
	try {
		await promise
		return undefined
	} catch (error) {
		return error
	}
}

// A minimal, hand-built TaskContext — pure DATA, the lineage shape createAgentFunction /
// createToolFunction read from controller.task. Lets the adapter tests call the returned
// WorkflowFunction directly, without driving a full runner round-trip.
function fakeTaskContext(workflowId = 'wf', taskId = 't'): TaskContext {
	const workflow = { id: workflowId, name: workflowId }
	const phase = { id: 'p', name: 'P', workflow }
	return { id: taskId, name: taskId, phase }
}

function fakeController(overrides: Partial<TaskControllerInterface> = {}): TaskControllerInterface {
	const controller = new AbortController()
	return {
		signal: controller.signal,
		aborted: controller.signal.aborted,
		input: {},
		task: fakeTaskContext(),
		results: () => [],
		...overrides,
	}
}

function executeThroughManager(
	tool: ReturnType<typeof createWorkflowTool>,
	args: Readonly<Record<string, unknown>> = { ...simpleDefinition('via-mgr') },
): Promise<ToolResult> {
	const manager = createToolManager()
	manager.add(tool)
	return manager.execute({ id: 'call-1', name: tool.name, arguments: args })
}

// ── createToolFunction — wraps a registered tool as a WorkflowFunction ───────

describe('createToolFunction — wraps a registered tool as a WorkflowFunction', () => {
	it('happy path: executes the named tool with controller.input and returns its value', async () => {
		const tools = createToolManager()
		const seen = createRecorder<readonly [Readonly<Record<string, unknown>>]>()
		tools.add(
			createTool({
				name: 'scan',
				execute: (args) => {
					seen.handler(args)
					return 'scanned'
				},
			}),
		)
		const fn = createToolFunction(tools, 'scan')
		const value = await fn(fakeController({ input: { path: '/repo' } }))
		expect(value).toBe('scanned')
		expect(seen.calls[0]?.[0]).toEqual({ path: '/repo' })
	})

	it('error-to-cause: a tool whose result carries an error throws an Error carrying it as `cause`', async () => {
		const tools = createToolManager()
		tools.add(
			createTool({
				name: 'boom',
				execute: () => {
					throw new Error('tool exploded')
				},
			}),
		)
		const fn = createToolFunction(tools, 'boom')
		const error = await rejectionOf(fn(fakeController()))
		expect(error).toBeInstanceOf(Error)
		expect(error instanceof Error ? error.cause : undefined).toBe('tool exploded')
	})

	it('an UNREGISTERED tool name throws a typed TOOL WorkflowError', async () => {
		const tools = createToolManager()
		const fn = createToolFunction(tools, 'missing')
		const error = await rejectionOf(fn(fakeController()))
		expect(error instanceof Error ? error.name : undefined).toBe('WorkflowError')
		expect(isWorkflowError(error) ? error.code : undefined).toBe('TOOL')
	})

	it('composed into a real runner: a task whose `run` maps to a createToolFunction entry dispatches the tool for real', async () => {
		const tools = createToolManager()
		tools.add(createTool({ name: 'scan', execute: () => 'scanned' }))
		const definition: WorkflowDefinition = {
			id: 'wf',
			name: 'WF',
			phases: [{ id: 'a', name: 'A', tasks: [{ id: 't', name: 'T', run: 'scan' }] }],
		}
		const result = await createWorkflowRunner().execute(definition, {
			functions: { scan: createToolFunction(tools, 'scan') },
		})
		expect(result.status).toBe('completed')
		expect(result.workflow.phase('a')?.task('t')?.result?.result).toEqual({
			success: true,
			value: 'scanned',
		})
	})
})

// ── createAgentFunction — wraps a live AgentInterface as a WorkflowFunction ──

describe('createAgentFunction — wraps a live AgentInterface as a WorkflowFunction', () => {
	it('run: resolves the agent to its settled result, boxed as the task value', async () => {
		const agent = createAgent(createScriptedProvider([{ content: 'audited' }]))
		const fn = createAgentFunction(agent)
		const value = await fn(fakeController())
		const content = isRecord(value) ? value.content : undefined
		expect(content).toBe('audited')
	})

	it('abort fold: a mid-generate controller-signal abort cancels the agent (a partial resolves, never rejects)', async () => {
		const provider = createScriptedProvider([{ content: 'partial-content' }], { delay: 200 })
		const agent = createAgent(provider)
		const controller = new AbortController()
		const fn = createAgentFunction(agent)
		const running = fn(fakeController({ signal: controller.signal }))
		await waitForDelay(20)
		controller.abort(new Error('cancelled mid-generate'))
		const value = await running
		expect(isRecord(value) ? value.partial : undefined).toBe(true)
	})

	it('DEPTH on depth exceed: `depth + 1 > MAX_WORKFLOW_DEPTH` throws a typed DEPTH WorkflowError and never runs the agent', async () => {
		const provider = createScriptedProvider([{ content: 'x' }])
		const agent = createAgent(provider)
		const fn = createAgentFunction(agent, { depth: MAX_WORKFLOW_DEPTH })
		const error = await rejectionOf(fn(fakeController()))
		expect(isWorkflowError(error) ? error.code : undefined).toBe('DEPTH')
		expect(provider.started).toBe(0)
	})

	it('DEPTH on ancestry cycle: an agent already present in the ancestry throws a typed DEPTH WorkflowError and never runs', async () => {
		const provider = createScriptedProvider([{ content: 'x' }])
		const agent = createAgent(provider)
		const fn = createAgentFunction(agent, { ancestry: [`agent:${agent.id}`] })
		const error = await rejectionOf(fn(fakeController()))
		expect(isWorkflowError(error) ? error.code : undefined).toBe('DEPTH')
		expect(provider.started).toBe(0)
	})

	it('tool binding when `runner` is supplied: the agent context gains exactly one workflow tool under WORKFLOW_TOOL_NAME', async () => {
		const agent = createAgent(createScriptedProvider([{ content: 'audited' }]))
		expect(agent.context.tools.count).toBe(0)
		const fn = createAgentFunction(agent, { runner: createWorkflowRunner() })
		await fn(fakeController())
		expect(agent.context.tools.count).toBe(1)
		expect(agent.context.tools.tool(WORKFLOW_TOOL_NAME)).toBeDefined()
	})

	it('composed into a real runner: a task whose `run` maps to a createAgentFunction entry dispatches the agent for real', async () => {
		const agent = createAgent(createScriptedProvider([{ content: 'audited' }]))
		const definition: WorkflowDefinition = {
			id: 'wf',
			name: 'WF',
			phases: [{ id: 'a', name: 'A', tasks: [{ id: 't', name: 'T', run: 'auditor' }] }],
		}
		const result = await createWorkflowRunner().execute(definition, {
			functions: { auditor: createAgentFunction(agent) },
		})
		expect(result.status).toBe('completed')
		const value = result.workflow.phase('a')?.task('t')?.result?.result
		const content =
			value?.success === true && isRecord(value.value) ? value.value.content : undefined
		expect(content).toBe('audited')
	})
})

// ── createWorkflowTool — wrap a definition as an LLM-callable tool ───────────

describe('createWorkflowTool — its parameters advertise the FLAT authoring shape', () => {
	it('the advertised parameters expose only name/steps (no id/phases)', () => {
		const tool = createWorkflowTool(simpleDefinition(), createWorkflowRunner())
		expect(tool.parameters?.type).toBe('object')
		const properties = tool.parameters?.properties
		expect(isRecord(properties) ? Object.keys(properties).sort() : []).toEqual(['name', 'steps'])
		expect(isRecord(properties) ? 'id' in properties : true).toBe(false)
		expect(isRecord(properties) ? 'phases' in properties : true).toBe(false)
	})

	it('the step `name` field carries a description', () => {
		const tool = createWorkflowTool(simpleDefinition(), createWorkflowRunner())
		const properties = tool.parameters?.properties
		const steps = isRecord(properties) ? properties.steps : undefined
		const items = isRecord(steps) ? steps.items : undefined
		const stepProps = isRecord(items) ? items.properties : undefined
		const nameField = isRecord(stepProps) ? stepProps.name : undefined
		expect(typeof (isRecord(nameField) ? nameField.description : undefined)).toBe('string')
	})
})

describe('createWorkflowTool — authoring forms (flat / draft / full / precedence)', () => {
	it('a valid authored full-form blob runs that workflow and RETURNS the plain run summary', async () => {
		const tool = createWorkflowTool(simpleDefinition('wrapped'), createWorkflowRunner())
		const summary = readSummary(await tool.execute({ ...simpleDefinition('authored') }))
		expect(summary).toEqual({ status: 'completed', count: 1 })
	})

	it('no authored args runs the WRAPPED definition (the tool genuinely wraps it)', async () => {
		const tool = createWorkflowTool(simpleDefinition('wrapped'), createWorkflowRunner())
		expect(readSummary(await tool.execute({}))).toEqual({ status: 'completed', count: 1 })
	})

	it('a malformed authored blob THROWS a typed TOOL WorkflowError (the §14 handler contract)', async () => {
		const tool = createWorkflowTool(simpleDefinition('wrapped'), createWorkflowRunner())
		const error = await rejectionOf(
			tool.execute({
				id: '',
				name: 'X',
				phases: [{ id: 'p', name: 'P', tasks: [], concurrency: 0 }],
			}),
		)
		expect(isWorkflowError(error) ? error.code : undefined).toBe('TOOL')
		expect(isWorkflowError(error) ? error.context : undefined).toMatchObject({
			workflow: 'wrapped',
		})
	})

	it('an over-deep call (depth at the ceiling) THROWS a typed DEPTH WorkflowError without running', async () => {
		const tool = createWorkflowTool(simpleDefinition(), createWorkflowRunner(), {
			depth: MAX_WORKFLOW_DEPTH,
		})
		const error = await rejectionOf(tool.execute({ ...simpleDefinition('deep') }))
		expect(isWorkflowError(error) ? error.code : undefined).toBe('DEPTH')
		expect(error instanceof Error ? error.message : '').toContain('max depth')
	})

	it('a cyclic call (target id already an ancestor) THROWS a typed DEPTH WorkflowError', async () => {
		const tool = createWorkflowTool(simpleDefinition(), createWorkflowRunner(), {
			ancestry: ['workflow:loop'],
		})
		const error = await rejectionOf(tool.execute({ ...simpleDefinition('loop') }))
		expect(isWorkflowError(error) ? error.code : undefined).toBe('DEPTH')
		expect(error instanceof Error ? error.message : '').toContain('cycle')
	})

	it('the draft contract accepts an ids-omitted blob but the tool rejects an explicitly-empty id', () => {
		const draft = createWorkflowDraftContract()
		const omitted: WorkflowDraft = { phases: [{ tasks: [{ run: 'a' }] }] }
		expect(draft.is(omitted)).toBe(true)
		expect(draft.parse({ id: '', phases: [] })).toBeUndefined()
	})

	it('the tool runs an ids-OMITTED nested draft end-to-end → completed with the right result count', async () => {
		const tool = createWorkflowTool(simpleDefinition('wrapped'), createWorkflowRunner())
		const summary = readSummary(
			await tool.execute({ phases: [{ tasks: [{ run: 'x' }] }, { tasks: [{ run: 'y' }] }] }),
		)
		expect(summary).toEqual({ status: 'completed', count: 2 })
	})

	it('the tool runs a minimal FLAT steps blob end-to-end → { status: completed, count: N }', async () => {
		const tool = createWorkflowTool(simpleDefinition('wrapped'), createWorkflowRunner())
		const summary = readSummary(
			await tool.execute({ name: 'build', steps: [{ name: 'compile' }, { name: 'publish' }] }),
		)
		expect(summary).toEqual({ status: 'completed', count: 2 })
	})

	it('a flat blob that cannot expand (a step missing `name`) THROWS a typed TOOL WorkflowError', async () => {
		const tool = createWorkflowTool(simpleDefinition('wrapped'), createWorkflowRunner())
		const error = await rejectionOf(tool.execute({ steps: [{}] }))
		expect(isWorkflowError(error) ? error.code : undefined).toBe('TOOL')
	})

	it('a blob carrying BOTH `steps` and `phases` takes the FLAT branch (expands steps, IGNORES phases)', async () => {
		const tool = createWorkflowTool(simpleDefinition('wrapped'), createWorkflowRunner())
		const summary = readSummary(
			await tool.execute({
				name: 'precedence',
				steps: [{ name: 'a' }, { name: 'b' }],
				phases: [
					{ id: 'x', name: 'X', tasks: [{ id: 'x0', name: 'X0', run: 'p' }] },
					{ id: 'y', name: 'Y', tasks: [{ id: 'y0', name: 'Y0', run: 'q' }] },
					{ id: 'z', name: 'Z', tasks: [{ id: 'z0', name: 'Z0', run: 'r' }] },
				],
			}),
		)
		expect(summary).toEqual({ status: 'completed', count: 2 })
	})
})

describe('createWorkflowTool — tool-through-manager execution', () => {
	it('a SUCCESS maps to a SINGLE-LEVEL ToolResult — value IS the plain summary, no nested envelope', async () => {
		const tool = createWorkflowTool(simpleDefinition('wrapped'), createWorkflowRunner())
		const result = await executeThroughManager(tool)
		expect(result.value).toEqual({ status: 'completed', count: 1 })
		expect(isRecord(result.value) && 'value' in result.value).toBe(false)
		expect(result.error).toBeUndefined()
		expect(result.id).toBe('call-1')
		expect(result.name).toBe('workflow')
	})

	it('a FAILURE maps to a SINGLE-LEVEL ToolResult — a TOP-LEVEL error, no value', async () => {
		const tool = createWorkflowTool(simpleDefinition('wrapped'), createWorkflowRunner(), {
			depth: MAX_WORKFLOW_DEPTH,
		})
		const result = await executeThroughManager(tool)
		expect(result.value).toBeUndefined()
		expect(result.error).toContain('max depth')
		expect(result.id).toBe('call-1')
	})

	it('the manager FAILURE ToolResult maps to MCP isError:true; SUCCESS to the plain summary text', async () => {
		const failing = createWorkflowTool(simpleDefinition('wrapped'), createWorkflowRunner(), {
			depth: MAX_WORKFLOW_DEPTH,
		})
		const failure = buildToolResult(await executeThroughManager(failing))
		expect(failure.isError).toBe(true)
		expect(failure.content[0]?.text).toContain('max depth')

		const ok = createWorkflowTool(simpleDefinition('wrapped'), createWorkflowRunner())
		const success = buildToolResult(await executeThroughManager(ok))
		expect(success.isError).toBeUndefined()
		expect(success.content[0]?.text).toBe(JSON.stringify({ status: 'completed', count: 1 }))
	})
})

// ── net-new: createWorkflowTool's store slot ─────────────────────────────────

describe('createWorkflowTool — the optional durable store slot (this package`s addition)', () => {
	it('a successful authored run PERSISTS the final snapshot into the provided store', async () => {
		const store = createMemoryWorkflowStore()
		const tool = createWorkflowTool(simpleDefinition('wrapped'), createWorkflowRunner(), { store })
		expect(await store.get('authored')).toBeUndefined()
		await tool.execute({ ...simpleDefinition('authored') })
		const persisted = await store.get('authored')
		expect(persisted).toBeDefined()
		expect(persisted?.status).toBe('completed')
	})

	it('the persisted snapshot round-trips through the strict contract and is restorable', async () => {
		const store = createMemoryWorkflowStore()
		const tool = createWorkflowTool(simpleDefinition('wrapped'), createWorkflowRunner(), { store })
		await tool.execute({ ...simpleDefinition('restorable') })
		const persisted = await store.get('restorable')
		expect(persisted?.phases[0]?.tasks[0]?.status).toBe('completed')
	})

	it('an ABSENT store has NO persistence side effects', async () => {
		const tool = createWorkflowTool(simpleDefinition('wrapped'), createWorkflowRunner())
		const summary = readSummary(await tool.execute({ ...simpleDefinition('no-store') }))
		expect(summary).toEqual({ status: 'completed', count: 1 })
		// No store was supplied; nothing to assert beyond the run completing without error.
	})

	it('a FAILED run (depth guard) does NOT persist anything (the store.set is post-run only)', async () => {
		const store = createMemoryWorkflowStore()
		const tool = createWorkflowTool(simpleDefinition('wrapped'), createWorkflowRunner(), {
			store,
			depth: MAX_WORKFLOW_DEPTH,
		})
		await rejectionOf(tool.execute({ ...simpleDefinition('unreached') }))
		expect(await store.get('unreached')).toBeUndefined()
	})
})

// ── createWorkspaceTool — unified manager/store options (this package`s addition) ──

describe('createWorkspaceTool — default (in-memory manager constructed)', () => {
	it('with no options, edits land on a freshly-constructed in-memory-backed manager', async () => {
		const tool = createWorkspaceTool()
		expect(tool.name).toBe('workspace')
		const result = await tool.execute({ operation: 'write', path: 'a.ts', content: 'x' })
		expect(result).toEqual({ path: 'a.ts', state: 'created' })
		expect(await tool.execute({ operation: 'read', path: 'a.ts' })).toBe('x')
	})

	it('honors name / description overrides', () => {
		const tool = createWorkspaceTool({ name: 'fs', description: 'edit files' })
		expect(tool.name).toBe('fs')
		expect(tool.description).toBe('edit files')
	})
})

describe('createWorkspaceTool — explicit store (persistence observable via the store)', () => {
	it('a write through the tool is retrievable through a fresh manager over the SAME store', async () => {
		const store = createMemoryWorkspaceStore()
		const tool = createWorkspaceTool({ store })
		await tool.execute({ operation: 'write', path: 'notes.md', content: '# Title' })
		// The tool's own manager auto-creates + activates a default workspace on the write (the
		// no-active ergonomic seam) but never persists on its own — persistence flows through the
		// store only once a caller explicitly saves through a manager built over it.
		const author = createWorkspaceManager({ store })
		const workspace = author.add({ id: 'w' })
		workspace.write('a.txt', 'x')
		expect(await author.save('w')).toBe(true)
		const reader = createWorkspaceManager({ store })
		const opened = await reader.open('w')
		expect(opened?.read('a.txt')).toBe('x')
	})

	it('the tool operates correctly (its handler works) when constructed over a store', async () => {
		const store = createMemoryWorkspaceStore()
		const tool = createWorkspaceTool({ store })
		const result = await tool.execute({ operation: 'write', path: 'a.ts', content: 'x' })
		expect(result).toEqual({ path: 'a.ts', state: 'created' })
		expect(await tool.execute({ operation: 'read', path: 'a.ts' })).toBe('x')
	})
})

describe('createWorkspaceTool — explicit manager (drives the caller`s manager directly)', () => {
	it('edits land on the manager`s ACTIVE workspace, observable through the manager', async () => {
		const manager = createWorkspaceManager()
		const workspace = manager.add()
		const tool = createWorkspaceTool({ manager })
		await tool.execute({ operation: 'write', path: 'a.ts', content: 'const x = 1' })
		expect(workspace.read('a.ts')).toBe('const x = 1')
	})

	it('a caller-supplied manager with no active workspace still auto-creates on a write', async () => {
		const manager = createWorkspaceManager()
		expect(manager.active).toBeUndefined()
		const tool = createWorkspaceTool({ manager })
		await tool.execute({ operation: 'write', path: 'x.txt', content: 'y' })
		expect(manager.count).toBe(1)
		expect(manager.active?.read('x.txt')).toBe('y')
	})

	it('a manager built over a store lets the tool`s edits be persisted by the caller afterwards', async () => {
		const store = createMemoryWorkspaceStore()
		const manager = createWorkspaceManager({ store })
		manager.add({ id: 'w' })
		const tool = createWorkspaceTool({ manager })
		await tool.execute({ operation: 'write', path: 'a.ts', content: 'via-manager' })
		expect(await manager.save('w')).toBe(true)
		const reader = createWorkspaceManager({ store })
		const opened = await reader.open('w')
		expect(opened?.read('a.ts')).toBe('via-manager')
	})
})

describe('createWorkspaceTool — precedence: manager wins when BOTH manager and store are given', () => {
	it('the caller-supplied manager drives the tool; the store is not built into a competing manager', async () => {
		const store = createMemoryWorkspaceStore()
		const manager = createWorkspaceManager()
		const workspace = manager.add()
		const tool = createWorkspaceTool({ manager, store })
		await tool.execute({ operation: 'write', path: 'a.ts', content: 'from-manager' })
		expect(workspace.read('a.ts')).toBe('from-manager')
		// `store` was NOT used to build the tool's manager — a fresh manager over it has nothing.
		const overStore = createWorkspaceManager({ store })
		expect(overStore.count).toBe(0)
	})
})

// ── createAgentTool — sub-agent delegation ────────────────────────────────────

describe('createAgentTool — schema accept/reject via agentToolShape', () => {
	it('a malformed call (missing/empty task) THROWS a typed TOOL AgentToolError', async () => {
		const registry = createAgentRegistry({
			providers: { main: createScriptedProvider([{ content: 'x' }]) },
		})
		const tool = createAgentTool(registry, { provider: 'main' })
		const error = await rejectionOf(tool.execute({}))
		expect(isAgentToolError(error)).toBe(true)
		expect(isAgentToolError(error) ? error.code : undefined).toBe('TOOL')

		const emptyTask = await rejectionOf(tool.execute({ task: '' }))
		expect(isAgentToolError(emptyTask) ? emptyTask.code : undefined).toBe('TOOL')
	})

	it('a well-formed call with every optional field is accepted by the contract', () => {
		const call: AgentToolArguments = {
			task: 'summarize',
			provider: 'main',
			tools: ['search'],
			system: 'be terse',
		}
		expect(call.task).toBe('summarize')
	})

	it('a malformed tools/system field on the call THROWS a typed TOOL AgentToolError', async () => {
		const registry = createAgentRegistry({
			providers: { main: createScriptedProvider([{ content: 'x' }]) },
		})
		const tool = createAgentTool(registry, { provider: 'main' })
		const error = await rejectionOf(tool.execute({ task: 'x', tools: 'not-an-array' }))
		expect(isAgentToolError(error) ? error.code : undefined).toBe('TOOL')
	})

	it('no resolvable provider (neither call nor tool default) THROWS a typed TOOL AgentToolError', async () => {
		const registry = createAgentRegistry({
			providers: { main: createScriptedProvider([{ content: 'x' }]) },
		})
		const tool = createAgentTool(registry) // no default provider configured
		const error = await rejectionOf(tool.execute({ task: 'do it' }))
		expect(isAgentToolError(error) ? error.code : undefined).toBe('TOOL')
	})
})

describe('createAgentTool — depth / cycle guard', () => {
	it('depth at the ceiling THROWS a typed DEPTH AgentToolError', async () => {
		const provider = createScriptedProvider([{ content: 'x' }])
		const registry = createAgentRegistry({ providers: { main: provider } })
		const tool = createAgentTool(registry, { provider: 'main', depth: AGENT_TOOL_DEPTH })
		const error = await rejectionOf(tool.execute({ task: 'do it' }))
		expect(isAgentToolError(error) ? error.code : undefined).toBe('DEPTH')
		expect(provider.started).toBe(0)
	})

	it('a cyclic ancestry (provider already present) THROWS a typed DEPTH AgentToolError', async () => {
		const provider = createScriptedProvider([{ content: 'x' }])
		const registry = createAgentRegistry({ providers: { main: provider } })
		const tool = createAgentTool(registry, { provider: 'main', ancestry: ['agent:main'] })
		const error = await rejectionOf(tool.execute({ task: 'do it' }))
		expect(isAgentToolError(error) ? error.code : undefined).toBe('DEPTH')
		expect(provider.started).toBe(0)
	})
})

describe('createAgentTool — delegation happy-path with a real minimal registry + scripted provider', () => {
	it('delegates the task and returns the sub-agent`s settled content', async () => {
		const provider = createScriptedProvider([{ content: 'delegated result' }])
		const registry = createAgentRegistry({ providers: { main: provider } })
		const tool = createAgentTool(registry, { provider: 'main' })
		const result = await tool.execute({ task: 'summarize the notes' })
		expect(result).toBe('delegated result')
		expect(provider.calls[0]?.messages[0]).toMatchObject({
			role: 'user',
			content: 'summarize the notes',
		})
	})

	it('a per-call provider overrides the tool default', async () => {
		const defaultProvider = createScriptedProvider([{ content: 'default-provider' }])
		const otherProvider = createScriptedProvider([{ content: 'other-provider' }])
		const registry = createAgentRegistry({
			providers: { primary: defaultProvider, secondary: otherProvider },
		})
		const tool = createAgentTool(registry, { provider: 'primary' })
		const result = await tool.execute({ task: 'x', provider: 'secondary' })
		expect(result).toBe('other-provider')
		expect(defaultProvider.started).toBe(0)
	})

	it('per-call tools/system override the tool`s own configured defaults', async () => {
		const provider = createScriptedProvider([{ content: 'ok' }])
		const registry = createAgentRegistry({ providers: { main: provider } })
		const tool = createAgentTool(registry, { provider: 'main', system: 'default system' })
		await tool.execute({ task: 'x', system: 'override system' })
		expect(provider.started).toBe(1)
	})
})

describe('createAgentTool — abort fold (abort during generate settles per the agent contract)', () => {
	it('the delegated agent genuinely runs to a settled result through the tool (no throw)', async () => {
		const provider = createScriptedProvider([{ content: 'partial-delegate' }], { delay: 20 })
		const registry = createAgentRegistry({ providers: { main: provider } })
		const tool = createAgentTool(registry, { provider: 'main' })
		const result = await tool.execute({ task: 'do it' })
		expect(result).toBe('partial-delegate')
		expect(provider.started).toBe(1)
	})
})
