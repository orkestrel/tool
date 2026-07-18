import type { WorkflowDraft, WorkflowSteps } from '@src/core'
import type {
	TaskResult,
	TaskStatus,
	WorkflowDefinition,
	WorkflowResult,
} from '@orkestrel/workflow'
import type { PromptType } from '@orkestrel/terminal'
import {
	agentTag,
	coerceAnswer,
	completeDraft,
	completePhaseDraft,
	completeTaskDraft,
	expandSteps,
	terminalToolCode,
	workflowTag,
	workflowToolSummary,
} from '@src/core'
import { TerminalError } from '@orkestrel/terminal'
import {
	buildPhaseContext,
	buildTaskContext,
	buildWorkflowContext,
	createWorkflow,
	createWorkflowContract,
} from '@orkestrel/workflow'
import { describe, expect, it } from 'vitest'

// tests/src/core/helpers.test.ts — mirrors src/core/helpers.ts. Pure, deterministic
// synthesis (AGENTS §16.1: real inputs, no mocks): the ancestry tag namespacing, the
// workflow-tool run summary, and the draft-completion / flat-steps-expansion pipeline
// that turns the tool's LENIENT authoring surfaces into a strict WorkflowDefinition
// (`@orkestrel/workflow`).

describe('ancestry tags — workflowTag / agentTag (depth/cycle chain identifiers)', () => {
	it('namespaces a workflow id and an agent name distinctly (no collision)', () => {
		expect(workflowTag('x')).toBe('workflow:x')
		expect(agentTag('x')).toBe('agent:x')
		expect(workflowTag('x')).not.toBe(agentTag('x'))
	})

	it('is a pure function of its input id/name', () => {
		expect(workflowTag('release')).toBe('workflow:release')
		expect(agentTag('reviewer')).toBe('agent:reviewer')
	})
})

describe('workflowToolSummary — WorkflowResult → the plain handler summary', () => {
	it('summarizes a run as the terminal status + the result count', () => {
		const workflowContext = buildWorkflowContext({ id: 'wf-1', name: 'WF' })
		const phaseContext = buildPhaseContext(workflowContext, { id: 'p', name: 'P' })
		const taskResult = (id: string, status: TaskStatus): TaskResult => ({
			task: buildTaskContext(phaseContext, { id, name: id }),
			phase: phaseContext,
			workflow: workflowContext,
			status,
			timestamp: 0,
		})
		const result: WorkflowResult = {
			workflow: createWorkflow({ id: 'wf-1', name: 'WF', phases: [] }),
			status: 'completed',
			results: [taskResult('t0', 'completed'), taskResult('t1', 'failed')],
		}
		expect(workflowToolSummary(result)).toEqual({ status: 'completed', count: 2 })
	})

	it('an empty result list summarizes to count 0', () => {
		const result: WorkflowResult = {
			workflow: createWorkflow({ id: 'wf-2', name: 'WF2', phases: [] }),
			status: 'completed',
			results: [],
		}
		expect(workflowToolSummary(result)).toEqual({ status: 'completed', count: 0 })
	})
})

describe('completeDraft — synthesize omitted ids/names into a strict definition', () => {
	it('fills EVERY missing id positionally + defaults each name to its (resolved) id', () => {
		const draft: WorkflowDraft = {
			phases: [{ tasks: [{ run: 'a' }, { run: 'b' }] }, { tasks: [{ run: 'c' }] }],
		}
		const definition = completeDraft(draft)
		expect(createWorkflowContract().is(definition)).toBe(true)
		expect(definition.id).toBe('wf')
		expect(definition.name).toBe('wf')
		expect(definition.phases.map((phase) => phase.id)).toEqual(['phase-0', 'phase-1'])
		expect(definition.phases[0]?.name).toBe('phase-0')
		expect(definition.phases[0]?.tasks.map((task) => task.id)).toEqual([
			'phase-0-task-0',
			'phase-0-task-1',
		])
		expect(definition.phases[0]?.tasks[0]?.name).toBe('phase-0-task-0')
		expect(definition.phases[1]?.tasks[0]?.id).toBe('phase-1-task-0')
		expect(definition.phases[0]?.tasks[0]?.run).toBe('a')
		expect(definition.phases[1]?.tasks[0]?.run).toBe('c')
	})

	it('PRESERVES a provided id/name verbatim and nests synthesized task ids under a provided phase id', () => {
		const definition = completeDraft({
			id: 'mine',
			phases: [{ id: 'p', name: 'Phase', tasks: [{ name: 'T', run: 'f' }] }],
		})
		expect(definition.id).toBe('mine')
		expect(definition.name).toBe('mine')
		expect(definition.phases[0]?.id).toBe('p')
		expect(definition.phases[0]?.name).toBe('Phase')
		expect(definition.phases[0]?.tasks[0]?.id).toBe('p-task-0')
		expect(definition.phases[0]?.tasks[0]?.name).toBe('T')
	})

	it('carries over description / concurrency / bail / retries / timeout unchanged', () => {
		const definition = completeDraft({
			description: 'desc',
			bail: true,
			phases: [
				{
					description: 'pd',
					concurrency: 3,
					bail: false,
					tasks: [{ run: 'x', retries: 2, timeout: 500, description: 'leaf' }],
				},
			],
		})
		expect(definition.description).toBe('desc')
		expect(definition.bail).toBe(true)
		expect(definition.phases[0]?.description).toBe('pd')
		expect(definition.phases[0]?.concurrency).toBe(3)
		expect(definition.phases[0]?.bail).toBe(false)
		expect(definition.phases[0]?.tasks[0]?.retries).toBe(2)
		expect(definition.phases[0]?.tasks[0]?.timeout).toBe(500)
		expect(definition.phases[0]?.tasks[0]?.description).toBe('leaf')
	})

	it('omits run/retries/timeout when the draft task declares none (no undefined keys)', () => {
		const definition = completeDraft({ phases: [{ tasks: [{}] }] })
		const task = definition.phases[0]?.tasks[0]
		expect(task && 'run' in task).toBe(false)
		expect(task && 'retries' in task).toBe(false)
		expect(task && 'timeout' in task).toBe(false)
	})

	it('is deterministic — the same draft always yields the same definition', () => {
		const draft: WorkflowDraft = { phases: [{ tasks: [{ run: 'x' }] }] }
		expect(completeDraft(draft)).toEqual(completeDraft(draft))
	})

	it('an empty-phases draft completes to a valid definition with no phases', () => {
		const definition = completeDraft({ phases: [] })
		expect(createWorkflowContract().is(definition)).toBe(true)
		expect(definition.phases).toEqual([])
	})

	it('completePhaseDraft / completeTaskDraft synthesize at their own positional index', () => {
		expect(completePhaseDraft({ tasks: [] }, 2).id).toBe('phase-2')
		expect(completeTaskDraft({ run: 't' }, 'phase-2', 5).id).toBe('phase-2-task-5')
	})

	it('completePhaseDraft preserves a provided phase id/name and its concurrency/bail', () => {
		const phase = completePhaseDraft(
			{ id: 'custom', name: 'Custom', tasks: [], concurrency: 4, bail: true },
			0,
		)
		expect(phase.id).toBe('custom')
		expect(phase.name).toBe('Custom')
		expect(phase.concurrency).toBe(4)
		expect(phase.bail).toBe(true)
	})

	it('completeTaskDraft preserves a provided task id/name', () => {
		const task = completeTaskDraft({ id: 'fixed', name: 'Fixed', run: 'f' }, 'phase-0', 0)
		expect(task.id).toBe('fixed')
		expect(task.name).toBe('Fixed')
	})
})

describe('expandSteps — flatten a steps blob into a one-task-phase-per-step definition', () => {
	it('maps each step to a one-task phase IN ORDER (a step`s name becomes the task`s run)', () => {
		const flat: WorkflowSteps = {
			name: 'pipeline',
			steps: [{ name: 'fetch' }, { name: 'scan' }, { name: 'audit' }],
		}
		const definition = expandSteps(flat)
		expect(createWorkflowContract().is(definition)).toBe(true)
		expect(definition.name).toBe('pipeline')
		expect(definition.phases).toHaveLength(3)
		expect(definition.phases.map((phase) => phase.tasks.length)).toEqual([1, 1, 1])
		expect(definition.phases.map((phase) => phase.id)).toEqual(['phase-0', 'phase-1', 'phase-2'])
		expect(definition.phases[0]?.tasks[0]?.id).toBe('phase-0-task-0')
		expect(definition.phases[0]?.tasks[0]?.run).toBe('fetch')
		expect(definition.phases[1]?.tasks[0]?.run).toBe('scan')
		expect(definition.phases[2]?.tasks[0]?.run).toBe('audit')
	})

	it('defaults the workflow id (and name) when no name is supplied', () => {
		const definition = expandSteps({ steps: [{ name: 'only' }] })
		expect(definition.id).toBe('wf')
		expect(definition.name).toBe('wf')
	})

	it('an empty steps list expands to a valid, phase-less definition', () => {
		const definition: WorkflowDefinition = expandSteps({ steps: [] })
		expect(createWorkflowContract().is(definition)).toBe(true)
		expect(definition.phases).toEqual([])
	})
})

describe('coerceAnswer — normalize an LLM-supplied answer to its prompt form', () => {
	it('confirm: passes a boolean through and coerces "true"/"false" strings', () => {
		expect(coerceAnswer('confirm', true)).toBe(true)
		expect(coerceAnswer('confirm', false)).toBe(false)
		expect(coerceAnswer('confirm', 'true')).toBe(true)
		expect(coerceAnswer('confirm', 'False')).toBe(false)
		expect(coerceAnswer('confirm', 'yes')).toBe(true)
		expect(coerceAnswer('confirm', '')).toBe(false)
	})

	it('checkbox: passes an array through, splits a comma-separated string, wraps a single string', () => {
		expect(coerceAnswer('checkbox', ['a', 'b'])).toEqual(['a', 'b'])
		expect(coerceAnswer('checkbox', 'a,b')).toEqual(['a', 'b'])
		expect(coerceAnswer('checkbox', 'a, b , c')).toEqual(['a', 'b', 'c'])
		expect(coerceAnswer('checkbox', 'solo')).toEqual(['solo'])
	})

	it('input/password/select/editor: passes a string through, stringifies a scalar, blanks an object', () => {
		expect(coerceAnswer('input', 'hi')).toBe('hi')
		expect(coerceAnswer('password', 'hi')).toBe('hi')
		expect(coerceAnswer('select', 'hi')).toBe('hi')
		expect(coerceAnswer('editor', 'hi')).toBe('hi')
		expect(coerceAnswer('input', 42)).toBe('42')
		expect(coerceAnswer('input', { a: 1 })).toBe('')
		expect(coerceAnswer('input', ['a'])).toBe('')
	})

	it('is deterministic — same form/value always yields the same result', () => {
		expect(coerceAnswer('checkbox', 'x,y')).toEqual(coerceAnswer('checkbox', 'x,y'))
	})
})

describe('pressure: coerceAnswer — hostile-value fuzz (totality, exact branch pinning)', () => {
	it('confirm: boolean passthrough — only literal true/false pass through unchanged', () => {
		expect(coerceAnswer('confirm', true)).toBe(true)
		expect(coerceAnswer('confirm', false)).toBe(false)
	})

	it('confirm: "TRUE" / " true " / "True" all case/whitespace-insensitively coerce true', () => {
		expect(coerceAnswer('confirm', 'TRUE')).toBe(true)
		expect(coerceAnswer('confirm', ' true ')).toBe(true)
		expect(coerceAnswer('confirm', 'True')).toBe(true)
	})

	it('confirm: 0 is NOT the string "false" — it falls through to Boolean(value), which is false', () => {
		expect(coerceAnswer('confirm', 0)).toBe(false)
	})

	it('confirm: a non-empty object/array is truthy-coerced via Boolean(value) (never "" special-cased)', () => {
		expect(coerceAnswer('confirm', {})).toBe(true)
		expect(coerceAnswer('confirm', [])).toBe(true)
	})

	it('checkbox: a comma-separated string with surrounding spaces trims every entry', () => {
		expect(coerceAnswer('checkbox', 'a, b , c')).toEqual(['a', 'b', 'c'])
	})

	it('checkbox: a single non-comma string wraps into a one-item array', () => {
		expect(coerceAnswer('checkbox', 'a')).toEqual(['a'])
	})

	it('checkbox: an array of strings passes through, stringifying each entry', () => {
		expect(coerceAnswer('checkbox', ['a', 'b'])).toEqual(['a', 'b'])
	})

	it('checkbox: a NESTED array entry stringifies to its Array.prototype.toString form ("a")', () => {
		expect(coerceAnswer('checkbox', [['a']])).toEqual(['a'])
	})

	it('checkbox: a bare number is NOT an array/string — falls to the [String(value)] fallback', () => {
		expect(coerceAnswer('checkbox', 5)).toEqual(['5'])
	})

	it('checkbox: a bare object is NOT an array/string — falls to the [String(value)] fallback ("[object Object]")', () => {
		expect(coerceAnswer('checkbox', {})).toEqual(['[object Object]'])
	})

	it('text forms (input/password/select/editor): a number scalar stringifies via String(value)', () => {
		expect(coerceAnswer('input', 42)).toBe('42')
		expect(coerceAnswer('password', 42)).toBe('42')
		expect(coerceAnswer('select', 42)).toBe('42')
		expect(coerceAnswer('editor', 42)).toBe('42')
	})

	it('text forms: a boolean scalar stringifies via String(value)', () => {
		expect(coerceAnswer('input', true)).toBe('true')
	})

	it('text forms: an object/array falls back to "" rather than serializing garbage', () => {
		expect(coerceAnswer('input', {})).toBe('')
		expect(coerceAnswer('input', [])).toBe('')
	})

	it('text forms: an empty string passes through verbatim (not stringified/blanked)', () => {
		expect(coerceAnswer('input', '')).toBe('')
	})

	it('is total — never throws for any hostile value across every form', () => {
		const hostileValues: readonly unknown[] = [
			'TRUE',
			' true ',
			'True',
			true,
			0,
			{},
			[],
			'a, b , c',
			'a',
			['a', 'b'],
			[['a']],
			42,
			'',
			null,
			undefined,
			NaN,
		]
		const forms: readonly PromptType[] = [
			'confirm',
			'checkbox',
			'input',
			'password',
			'select',
			'editor',
		]
		for (const form of forms) {
			for (const value of hostileValues) {
				expect(() => coerceAnswer(form, value)).not.toThrow()
			}
		}
	})
})

describe('terminalToolCode — classify a caught error into an AgentToolErrorCode', () => {
	it('maps DEADLOCK and EXPIRE to their own code', () => {
		expect(terminalToolCode(new TerminalError('DEADLOCK', 'cycle'))).toBe('DEADLOCK')
		expect(terminalToolCode(new TerminalError('EXPIRE', 'timed out'))).toBe('EXPIRE')
	})

	it('maps every other TerminalErrorCode to the generic TOOL code', () => {
		expect(terminalToolCode(new TerminalError('TARGET', 'unknown terminal'))).toBe('TOOL')
		expect(terminalToolCode(new TerminalError('CANCEL', 'aborted'))).toBe('TOOL')
		expect(terminalToolCode(new TerminalError('DRIVER', 'io failure'))).toBe('TOOL')
	})

	it('returns undefined for a non-TerminalError value', () => {
		expect(terminalToolCode(new Error('plain'))).toBeUndefined()
		expect(terminalToolCode('nope')).toBeUndefined()
		expect(terminalToolCode(undefined)).toBeUndefined()
	})
})
