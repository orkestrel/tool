import type { AuditFault, ContractInterface } from '@orkestrel/contract'
import type { ToolDefinition, ToolFailure, ToolInterface } from './types.js'
import { FAULT_LIMIT, isObject, isString, limitEntries, preview } from '@orkestrel/contract'

/**
 * Projects a tool onto the plain definition advertised to a caller, advertising an
 * authored `summary` in place of the full description and carrying `parameters` and
 * `annotations` by reference.
 *
 * @remarks
 * The projection carries `name` and present `title`, `description`, `parameters`, and
 * `annotations` fields in that order. The full `description` stays on the tool for
 * direct lookup, and the definition is never a live handle on the tool's handler.
 *
 * @param tool - The tool to project
 * @returns A fresh definition carrying only the fields the tool authored
 *
 * @example
 * ```ts
 * import { Tool, toolToDefinition } from '@orkestrel/tool'
 *
 * const now = new Tool({ name: 'now', summary: 'Read the clock.', execute: () => Date.now() })
 * toolToDefinition(now).description // 'Read the clock.'
 * ```
 */
export function toolToDefinition(tool: ToolInterface): ToolDefinition {
	const description = tool.summary ?? tool.description
	return {
		name: tool.name,
		...(tool.title === undefined ? {} : { title: tool.title }),
		...(description === undefined ? {} : { description }),
		...(tool.parameters === undefined ? {} : { parameters: tool.parameters }),
		...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
	}
}

/**
 * Walks an argument record through a contract's reports and returns the faults the Tool door
 * refuses, empty when the record may proceed to `parse`.
 *
 * @remarks
 * Every parse fault refuses, and any undeclared key is reported beside it so one refusal names
 * both. With no parse fault, an undeclared key, a `variant` fault, and a `oneOf` fault refuse: a
 * union repairs by declaration order, so a coercion through one is not a repair. A coercible leaf
 * alone does not refuse, unless the audit reached `FAULT_LIMIT`, where its cap can hide an
 * undeclared key. The report holds at most `FAULT_LIMIT` entries.
 *
 * @param contract - The compiled contract of the tool's arguments
 * @param value - The arguments record the caller sent
 * @returns The faults to refuse with, or an empty list
 *
 * @example
 * ```ts
 * import { createContract, numberShape, objectShape } from '@orkestrel/contract'
 * import { scanFaults } from '@orkestrel/tool'
 *
 * const contract = createContract(objectShape({ amount: numberShape() }))
 * scanFaults(contract, { amount: '3' }) // []
 * scanFaults(contract, { amount: 3, extra: 1 }) // [{ reason: 'extra', path: ['extra'] }]
 * ```
 */
export function scanFaults(
	contract: ContractInterface<unknown>,
	value: unknown,
): readonly AuditFault[] {
	const explained = contract.explain(value)
	const audited = contract.audit(value)
	if (explained.length > 0) {
		return limitEntries(
			[...explained, ...audited.filter((fault) => fault.reason === 'extra')],
			FAULT_LIMIT,
		)
	}
	const refused = audited.filter(
		(fault) => fault.reason === 'extra' || fault.reason === 'variant' || fault.reason === 'oneOf',
	)
	return refused.length === 0 && audited.length >= FAULT_LIMIT ? audited : refused
}

/**
 * Describes a fault report as text a caller corrects from, one fault per line.
 *
 * @remarks
 * Each line holds the fault's path and reason, then what the fault carries. An array path joins
 * with `.`, and a root path is empty, so its line starts with `: `. A path segment that is not a
 * plain identifier is JSON-encoded and length-capped, because a key the caller sent is untrusted
 * text. A report at `FAULT_LIMIT` closes with a line saying that it stops there.
 *
 * @param faults - The faults to describe
 * @returns The refusal message
 *
 * @example
 * ```ts
 * import { describeFaults } from '@orkestrel/tool'
 *
 * describeFaults([{ reason: 'missing', path: ['left'], expected: 'number' }]) // 'left: missing; expected number'
 * ```
 */
export function describeFaults(faults: readonly AuditFault[]): string {
	return [
		...faults.map((fault) =>
			[
				`${(isString(fault.path) ? [fault.path] : fault.path)
					.map((segment) => (/^[\w$-]{1,64}$/u.test(segment) ? segment : preview(segment)))
					.join('.')}: ${fault.reason}`,
				...(fault.reason === 'extra' ? ['this key is not declared, remove it'] : []),
				...('expected' in fault ? [`expected ${fault.expected}`] : []),
				...('received' in fault ? [`received ${fault.received}`] : []),
				...('constraint' in fault ? [`constraint ${fault.constraint}`] : []),
				...('limit' in fault && fault.limit !== undefined ? [`limit ${String(fault.limit)}`] : []),
				...('variants' in fault ? [`variants ${String(fault.variants)}`] : []),
				...('matched' in fault ? [`matched ${String(fault.matched)}`] : []),
			].join('; '),
		),
		...(faults.length >= FAULT_LIMIT
			? [`the report stops at ${String(FAULT_LIMIT)} faults; correct these and call again`]
			: []),
	].join('\n')
}

/**
 * Builds the failure a registry answers with for a value that is not a `ToolCall`, carrying each
 * of its `id` and `name` that is a string and leaving the other empty.
 *
 * @param call - The value the registry received in place of a call
 * @returns The failure naming what a call must hold
 *
 * @example
 * ```ts
 * import { buildCallRefusal } from '@orkestrel/tool'
 *
 * buildCallRefusal({ id: '1', name: 'add' }).success // false
 * ```
 */
export function buildCallRefusal(call: unknown): ToolFailure {
	const id: unknown = isObject(call) ? Reflect.get(call, 'id') : undefined
	const name: unknown = isObject(call) ? Reflect.get(call, 'name') : undefined
	return {
		id: isString(id) ? id : '',
		name: isString(name) ? name : '',
		success: false,
		error:
			'malformed call: a call needs a string id, a string name, and a plain record of arguments',
	}
}
