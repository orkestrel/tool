import type { WorkflowDefinition, WorkflowResult, WorkflowStatus } from '@orkestrel/workflow'
import type { PhaseDraft, TaskDraft, WorkflowDraft, WorkflowSteps } from './types.js'

// Tool-package helpers — OWNED here now, ported byte-faithfully from `@orkestrel/workflow` ahead
// of the upstream cleanup that drops the authoring surface from that package (this package
// becomes the defining home for the workflow tool's lenient-authoring pipeline and its ancestry
// tagging).

/**
 * The ancestry identifier of a workflow in a run chain — `workflow:<id>`.
 *
 * @remarks
 * Namespacing keeps a workflow id and an {@link agentTag} agent name in ONE set without
 * collision, so re-entering a workflow OR an agent already in the chain is a single `includes`
 * check.
 *
 * @param id - The workflow definition's `id`
 * @returns The namespaced ancestry tag (`workflow:<id>`)
 */
export function workflowTag(id: string): string {
	return `workflow:${id}`
}

/**
 * The ancestry identifier of an agent in a run chain — `agent:<name>`.
 *
 * @remarks
 * The agent counterpart of {@link workflowTag}: {@link import('./factories.js').createAgentFunction}
 * / {@link import('./factories.js').createWorkflowTool} guard against re-entering an agent or
 * workflow already in the chain (a typed `DEPTH` `WorkflowError`, `@orkestrel/workflow`). The
 * `agent:` namespace keeps it distinct from a same-string workflow id.
 *
 * @param name - The agent's identifier / registry name
 * @returns The namespaced ancestry tag (`agent:<name>`)
 */
export function agentTag(name: string): string {
	return `agent:${name}`
}

/**
 * Build the plain success summary {@link import('./factories.js').createWorkflowTool} returns on
 * a completed run — the universal tool-handler contract (AGENTS §14): return a plain value on
 * success, appearing identically over BOTH the agent loop and MCP.
 *
 * @remarks
 * The summary is LEAN: the workflow's terminal `status` and the COUNT of settled task results —
 * enough for a caller / model to react without serializing the whole live tree. (It carries no
 * synthetic `id` / `name`: a tool handler has no call id; the `ToolManagerInterface`
 * (`@orkestrel/agent`) supplies the canonical envelope's identity.)
 *
 * @param result - The terminal `WorkflowResult` (`@orkestrel/workflow`) the run produced
 * @returns The plain success summary — `{ status, count }`
 */
export function workflowToolSummary(
	result: WorkflowResult,
): Readonly<{ status: WorkflowStatus; count: number }> {
	return { status: result.status, count: result.results.length }
}

// === Draft completion + flat-steps expansion (the tool's LENIENT authoring surfaces)
//
// Pure, deterministic synthesis that turns a WIDENED authoring form into a strict
// `WorkflowDefinition` (`@orkestrel/workflow`). They auto-fill only OMITTED identity (a provided
// id/name is preserved verbatim; an explicitly-empty `id: ''` is rejected UPSTREAM by the draft
// contract, never reached here), so a small model can author a complete tree without emitting
// the six required `id`/`name` strings. The factory re-validates the result against the STRICT
// `createWorkflowContract().is` gate before running (soundness).

/**
 * Complete a {@link WorkflowDraft} into a strict {@link WorkflowDefinition} — synthesize any
 * MISSING `id` deterministically + positionally, and default any MISSING `name` to its
 * (now-resolved) `id`.
 *
 * @remarks
 * The positional id scheme is stable and human-legible: the workflow is `wf`, phase `i` is
 * `phase-<i>`, and task `j` of that phase is `<phaseId>-task-<j>` (so a provided phase id flows
 * into its tasks' synthesized ids). A PROVIDED `id` / `name` at any level is kept VERBATIM —
 * synthesis touches only the omitted ones. A missing `name` defaults to the resolved `id` (never
 * the other way round), so the result always has both. `run`, `description`, the per-phase
 * `concurrency` / `bail`, the per-task `retries` / `timeout`, and the workflow `bail` carry over
 * unchanged. The result is a complete {@link WorkflowDefinition}; the caller still validates it
 * against the STRICT contract.
 *
 * @param draft - The draft workflow (id/name optional at all three levels)
 * @returns A complete {@link WorkflowDefinition} with every id/name filled
 */
export function completeDraft(draft: WorkflowDraft): WorkflowDefinition {
	const id = draft.id ?? 'wf'
	return {
		id,
		name: draft.name ?? id,
		...(draft.description === undefined ? {} : { description: draft.description }),
		phases: draft.phases.map((phase, index) => completePhaseDraft(phase, index)),
		...(draft.bail === undefined ? {} : { bail: draft.bail }),
	}
}

/**
 * Complete one {@link PhaseDraft} into a strict phase definition — the per-phase step of
 * {@link completeDraft} (phase `index` → `phase-<index>` when its id is omitted).
 *
 * @param phase - The draft phase
 * @param index - The phase's positional index in the workflow
 * @returns A complete phase definition
 */
export function completePhaseDraft(
	phase: PhaseDraft,
	index: number,
): WorkflowDefinition['phases'][number] {
	const id = phase.id ?? `phase-${index}`
	return {
		id,
		name: phase.name ?? id,
		...(phase.description === undefined ? {} : { description: phase.description }),
		tasks: phase.tasks.map((task, taskIndex) => completeTaskDraft(task, id, taskIndex)),
		...(phase.concurrency === undefined ? {} : { concurrency: phase.concurrency }),
		...(phase.bail === undefined ? {} : { bail: phase.bail }),
	}
}

/**
 * Complete one {@link TaskDraft} into a strict task definition — the per-task leaf step of
 * {@link completeDraft} (task `index` of phase `<phaseId>` → `<phaseId>-task-<index>` when its id
 * is omitted).
 *
 * @param task - The draft task
 * @param phaseId - The (resolved) parent phase id, so the synthesized task id nests under it
 * @param index - The task's positional index within its phase
 * @returns A complete task definition
 */
export function completeTaskDraft(
	task: TaskDraft,
	phaseId: string,
	index: number,
): WorkflowDefinition['phases'][number]['tasks'][number] {
	const id = task.id ?? `${phaseId}-task-${index}`
	return {
		id,
		name: task.name ?? id,
		...(task.description === undefined ? {} : { description: task.description }),
		...(task.run === undefined ? {} : { run: task.run }),
		...(task.retries === undefined ? {} : { retries: task.retries }),
		...(task.timeout === undefined ? {} : { timeout: task.timeout }),
	}
}

/**
 * Expand a flat {@link WorkflowSteps} blob into a strict {@link WorkflowDefinition} — each step
 * becomes a one-task phase, IN ORDER.
 *
 * @remarks
 * The expansion of the tool's ADVERTISED surface: the deliberately-reduced flat form. Each
 * {@link import('./types.js').WorkflowStep} maps to a phase holding exactly one task: the step's
 * `name` becomes the task's `run` (the behavior-registry key). Ids/names are auto-filled
 * positionally — it builds an ids-omitted {@link WorkflowDraft} and delegates to
 * {@link completeDraft}, so the two lenient surfaces share ONE synthesis path (step `i` → phase
 * `phase-<i>`, its task `phase-<i>-task-0`). The optional `name` becomes the workflow's `name`.
 * The result is a complete definition the caller validates against the STRICT contract before
 * running.
 *
 * @param flat - The flat steps blob (`{ name?, steps: [{ name }] }`)
 * @returns A complete {@link WorkflowDefinition} (one one-task phase per step)
 */
export function expandSteps(flat: WorkflowSteps): WorkflowDefinition {
	return completeDraft({
		...(flat.name === undefined ? {} : { name: flat.name }),
		phases: flat.steps.map((step) => ({
			tasks: [{ run: step.name }],
		})),
	})
}
