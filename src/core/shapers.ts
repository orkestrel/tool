import {
	arrayShape,
	booleanShape,
	integerShape,
	literalShape,
	objectShape,
	optionalShape,
	stringShape,
	unionShape,
} from '@orkestrel/contract'

// Tool-package shapes — the shape VALUE each `create*Tool` factory (factories.ts) compiles into
// the lockstep guard + parser + JSON Schema outputs (AGENTS §14). `agentToolShape` MUST agree
// with the hand-written `AgentToolArguments` (types.ts), which is the source of truth.
// `workflowStepsShape` / `workflowDraftShape` / `workspaceToolShape` are OWNED here now — ported
// byte-faithfully from `@orkestrel/workflow` / `@orkestrel/agent` ahead of the upstream cleanup
// that drops the authoring surface from those packages (this package becomes the defining home).

/**
 * The shape of {@link import('./types.js').AgentToolArguments} —
 * {@link import('./factories.js').createAgentTool}'s advertised `parameters`.
 *
 * @remarks
 * `task` is the only required field (a non-empty string); `provider` / `tools` / `system`
 * are per-call overrides of the tool's own configured defaults.
 */
export const agentToolShape = objectShape({
	task: stringShape({
		min: 1,
		description: 'The instructions the sub-agent should carry out.',
	}),
	provider: optionalShape(
		stringShape({
			min: 1,
			description:
				'Registry key of the provider to run the sub-agent against (overrides the default).',
		}),
	),
	tools: optionalShape(
		arrayShape(stringShape({ min: 1 }), {
			description:
				'Registry keys of the tools loaded into the sub-agent (replaces the default list).',
		}),
	),
	system: optionalShape(
		stringShape({
			description: "A system prompt seeding the sub-agent's context (overrides the default).",
		}),
	),
})

/**
 * The shape of {@link import('./types.js').DescribeToolArguments} —
 * {@link import('./factories.js').createDescribeTool}'s advertised `parameters`.
 *
 * @remarks
 * `name` is the only field (a non-empty string) — the registered tool name to look up.
 */
export const describeToolShape = objectShape({
	name: stringShape({
		min: 1,
		description: 'The registered name of the tool whose full description to return.',
	}),
})

// === Workflow draft / flat-steps shapes (OWNED here now, ported from `@orkestrel/workflow`)

/**
 * The shape of a {@link import('./types.js').TaskDraft} — identical to a strict task shape
 * EXCEPT `id` and `name` are OPTIONAL.
 */
export const taskDraftShape = objectShape({
	id: optionalShape(stringShape({ min: 1, description: 'Task id; auto-filled when omitted.' })),
	name: optionalShape(
		stringShape({ min: 1, description: 'Task name; defaults to the id when omitted.' }),
	),
	description: optionalShape(stringShape({ description: 'Optional task description.' })),
	run: optionalShape(
		stringShape({
			min: 1,
			description:
				'The registered behavior name to invoke (a registry key, not a label); omitted has no handler.',
		}),
	),
	retries: optionalShape(
		integerShape({
			min: 0,
			description:
				'Extra attempts after the first on failure; overrides the phase default. Omitted means none.',
		}),
	),
	timeout: optionalShape(
		integerShape({
			min: 0,
			description:
				'Per-attempt deadline in milliseconds; overrides the phase default. Omitted means no deadline.',
		}),
	),
})

/**
 * The shape of a PHASE in a draft workflow — identical to a strict phase shape EXCEPT `id` and
 * `name` are OPTIONAL, and its tasks are {@link taskDraftShape}s.
 */
export const phaseDraftShape = objectShape({
	id: optionalShape(stringShape({ min: 1, description: 'Phase id; auto-filled when omitted.' })),
	name: optionalShape(
		stringShape({ min: 1, description: 'Phase name; defaults to the id when omitted.' }),
	),
	description: optionalShape(stringShape({ description: 'Optional phase description.' })),
	tasks: arrayShape(taskDraftShape, { description: 'The phase tasks; they run CONCURRENTLY.' }),
	concurrency: optionalShape(
		integerShape({
			min: 1,
			description: 'Max tasks in flight at once (a resource throttle); omitted means unbounded.',
		}),
	),
	bail: optionalShape(
		literalShape([true, false], {
			description: 'Per-phase failure-policy override; omitted inherits the workflow bail.',
		}),
	),
})

/**
 * The shape of a DRAFT workflow — identical to a strict workflow shape EXCEPT `id` and `name`
 * are OPTIONAL at all three levels (workflow / phase / task), so a small model can omit the six
 * identity strings and let the tool synthesize them positionally.
 *
 * @remarks
 * The lenient counterpart {@link import('./factories.js').createWorkflowDraftContract} compiles.
 * `run` stays required on the strict form; a provided `id` / `name` still has `minLength: 1` (so
 * an explicitly-empty `id: ''` is REJECTED, not auto-filled). After
 * {@link import('./helpers.js').completeDraft} fills the missing ids/names, the result is
 * validated against the STRICT `createWorkflowContract` (`@orkestrel/workflow`) gate before
 * running.
 */
export const workflowDraftShape = objectShape({
	id: optionalShape(stringShape({ min: 1, description: 'Workflow id; auto-filled when omitted.' })),
	name: optionalShape(
		stringShape({ min: 1, description: 'Workflow name; defaults to the id when omitted.' }),
	),
	description: optionalShape(stringShape({ description: 'Optional workflow description.' })),
	phases: arrayShape(phaseDraftShape, {
		description: 'The workflow phases; they run SEQUENTIALLY, in order.',
	}),
	bail: optionalShape(
		literalShape([true, false], {
			description:
				'Failure policy: false (default) continues gracefully, true halts on the first failure.',
		}),
	),
})

/**
 * The shape of ONE flat step — `{ name }` — the building block of {@link workflowStepsShape}.
 *
 * @remarks
 * `name` is the REGISTERED behavior name the step runs (it becomes the task's `run`). The tool
 * expands each step into a one-task phase, in order ({@link import('./helpers.js').expandSteps}).
 */
export const stepShape = objectShape({
	name: stringShape({
		min: 1,
		description: 'The registered behavior name this step runs (becomes the task run).',
	}),
})

/**
 * The FLAT authoring shape {@link import('./factories.js').createWorkflowTool} advertises as its
 * `parameters` — the simplest surface a small model can fill: `{ name?, steps: [{ name }] }`.
 *
 * @remarks
 * A deliberately-reduced surface: a flat ordered list of steps, each a `{ name }`. The tool
 * EXPANDS it ({@link import('./helpers.js').expandSteps}) into a full
 * {@link import('./types.js').WorkflowDefinition} — one one-task phase per step, in order —
 * then validates against the STRICT `createWorkflowContract` (`@orkestrel/workflow`) gate. The
 * full nested form is STILL accepted by the tool (it branches on the args' shape) and is
 * documented as the advanced escape-hatch in the tool's description — but THIS is what
 * `parameters` advertises.
 */
export const workflowStepsShape = objectShape({
	name: optionalShape(stringShape({ min: 1, description: 'Optional workflow name.' })),
	steps: arrayShape(stepShape, {
		description: 'The ordered steps to run, one after another (each becomes a one-task phase).',
	}),
})

// === Workspace operation shape (OWNED here now, ported from `@orkestrel/agent`)

/**
 * The shape of a {@link import('./types.js').WorkspaceOperation} — a descriptive tagged union
 * over the 13 workspace edit / read / navigation operations, discriminated by the `operation`
 * literal (never a bare `kind`; AGENTS §4.4). Each variant leads with its `operation`
 * discriminant then its FLAT fields, every field via `stringShape` / `optionalShape` /
 * `integerShape({ min: 1 })` / `booleanShape`, each carrying a strong field-level `description`.
 *
 * @remarks
 * The union compiles to an `anyOf` JSON Schema + a `unionOf` guard + a first-match parser
 * automatically ({@link import('./factories.js').createWorkspaceTool} types the result to the
 * hand-written {@link import('./types.js').WorkspaceOperation}). `limit` and the four `'splice'`
 * caret components are POSITIVE integers (`integerShape({ min: 1 })`); `regex` / `exact` are
 * `optionalShape(booleanShape(...))`. The two REGISTRY arms — `workspaces` (list the workspaces
 * the model can move between) and `switch` (re-point the active one by `id`) — let a model
 * DISCOVER then CHOOSE which workspace the edit / read arms target.
 */
export const workspaceToolShape = unionShape(
	objectShape({
		operation: literalShape(['read'], { description: "Read a whole text file's text by path." }),
		path: stringShape({ description: 'The path of the file to read.' }),
	}),
	objectShape({
		operation: literalShape(['list'], { description: 'List every file in the workspace.' }),
	}),
	objectShape({
		operation: literalShape(['has'], { description: 'Check whether a file exists at the path.' }),
		path: stringShape({ description: 'The path to check for.' }),
	}),
	objectShape({
		operation: literalShape(['search'], {
			description: 'Search every text file for a query, returning each hit.',
		}),
		query: stringShape({ description: 'The text (or regular-expression source) to search for.' }),
		regex: optionalShape(
			booleanShape({
				description:
					'Treat the query as a regular expression. Defaults to false (a literal substring).',
			}),
		),
		exact: optionalShape(
			booleanShape({
				description: 'Match case-sensitively. Defaults to true (set false for case-insensitive).',
			}),
		),
		limit: optionalShape(
			integerShape({
				min: 1,
				description: 'Stop after this many matches across all files. Omitted means unlimited.',
			}),
		),
	}),
	objectShape({
		operation: literalShape(['replace'], {
			description: 'Replace a query with a replacement across every text file.',
		}),
		query: stringShape({ description: 'The text (or regular-expression source) to replace.' }),
		replacement: stringShape({ description: 'The text to substitute for each match.' }),
		regex: optionalShape(
			booleanShape({
				description:
					'Treat the query as a regular expression. Defaults to false (a literal substring).',
			}),
		),
		exact: optionalShape(
			booleanShape({
				description: 'Match case-sensitively. Defaults to true (set false for case-insensitive).',
			}),
		),
		limit: optionalShape(
			integerShape({
				min: 1,
				description: 'Stop after this many replacements across all files. Omitted means unlimited.',
			}),
		),
	}),
	objectShape({
		operation: literalShape(['write'], {
			description: 'Create or overwrite a whole file with content.',
		}),
		path: stringShape({ description: 'The path of the file to write.' }),
		content: stringShape({ description: 'The full new contents of the file.' }),
	}),
	objectShape({
		operation: literalShape(['splice'], {
			description:
				'Replace a 1-based range of an existing text file (from inclusive, to exclusive) with content.',
		}),
		path: stringShape({ description: 'The path of the text file to edit.' }),
		content: stringShape({ description: 'The text to splice in place of the range.' }),
		fromLine: integerShape({
			min: 1,
			description: 'The 1-based start line of the range (inclusive).',
		}),
		fromColumn: integerShape({
			min: 1,
			description:
				'The 1-based start column of the range (inclusive; column 1 is the first character).',
		}),
		toLine: integerShape({ min: 1, description: 'The 1-based end line of the range (exclusive).' }),
		toColumn: integerShape({
			min: 1,
			description: 'The 1-based end column of the range (exclusive).',
		}),
	}),
	objectShape({
		operation: literalShape(['prepend'], {
			description: 'Add content to the start of a file (creating it when absent).',
		}),
		path: stringShape({ description: 'The path of the file to prepend to.' }),
		content: stringShape({ description: 'The text to add at the start of the file.' }),
	}),
	objectShape({
		operation: literalShape(['append'], {
			description: 'Add content to the end of a file (creating it when absent).',
		}),
		path: stringShape({ description: 'The path of the file to append to.' }),
		content: stringShape({ description: 'The text to add at the end of the file.' }),
	}),
	objectShape({
		operation: literalShape(['move'], {
			description: 'Rename or move a file (overwriting an occupied target).',
		}),
		from: stringShape({ description: 'The current path of the file.' }),
		to: stringShape({ description: 'The new path for the file.' }),
	}),
	objectShape({
		operation: literalShape(['remove'], { description: 'Delete a file from the workspace.' }),
		path: stringShape({ description: 'The path of the file to remove.' }),
	}),
	objectShape({
		operation: literalShape(['workspaces'], {
			description:
				'List the workspaces you can move between (each id, file count, and whether it is active), so you can pick an id to switch to.',
		}),
	}),
	objectShape({
		operation: literalShape(['switch'], {
			description:
				'Switch the active workspace to the one with this id (get ids from the "workspaces" operation). Edit and read operations then target it.',
		}),
		id: stringShape({
			description: 'The id of the workspace to make active (from the "workspaces" listing).',
		}),
	}),
)
