import type { AuditFault, ContractInterface, JSONSchema } from '@orkestrel/contract'
import type { ToolDefinition, ToolFailure, ToolInterface } from './types.js'
import {
	FAULT_LIMIT,
	attempt,
	isObject,
	isRecord,
	isString,
	limitEntries,
	preview,
} from '@orkestrel/contract'
import { REFUSAL_LIST_LIMIT, REFUSAL_SCHEMA_LIMIT, REFUSAL_TEXT_LIMIT } from './constants.js'

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
 * Extracts a fault's path as its segments, reading a string path as one segment.
 *
 * @param fault - The fault to read
 * @returns The path's segments, empty at the root
 *
 * @example
 * ```ts
 * import { extractPath } from '@orkestrel/tool'
 *
 * extractPath({ reason: 'extra', path: ['page', 'typo'] }) // ['page', 'typo']
 * ```
 */
export function extractPath(fault: AuditFault): readonly string[] {
	return isString(fault.path) ? [fault.path] : fault.path
}

/**
 * Extracts a schema's forms: the schema itself, then the arms of its `anyOf`, so a read looks
 * through a nullable the same way everywhere.
 *
 * @param schema - The schema to read, or `undefined` where none was found
 * @returns The forms, empty when there is no schema
 *
 * @example
 * ```ts
 * import { extractForms } from '@orkestrel/tool'
 *
 * const object = { type: 'object' } as const
 * extractForms({ anyOf: [object] }) // [{ anyOf: [object] }, object]
 * ```
 */
export function extractForms(schema: JSONSchema | undefined): readonly JSONSchema[] {
	return schema === undefined ? [] : [schema, ...(schema.anyOf ?? [])]
}

/**
 * Extracts the part of a schema a path reaches, through properties, array items, record values,
 * and the arms of a union.
 *
 * @remarks
 * Each path segment takes one step, so a union that nests itself cannot hold the walk. Only a
 * schema's own `properties` keys match, so `constructor` reaches nothing.
 *
 * @param schema - The schema to walk
 * @param path - The segments to follow
 * @returns The schema at that path, or `undefined` where the schema declares nothing there
 *
 * @example
 * ```ts
 * import { extractSchema } from '@orkestrel/tool'
 *
 * const schema = { type: 'object', properties: { limit: { type: 'number' } } } as const
 * extractSchema(schema, ['limit']) // { type: 'number' }
 * ```
 */
export function extractSchema(schema: JSONSchema, path: readonly string[]): JSONSchema | undefined {
	return path.reduce<JSONSchema | undefined>(
		(node, key) =>
			extractForms(node)
				.map((form) =>
					form.properties !== undefined && Object.hasOwn(form.properties, key)
						? form.properties[key]
						: isRecord(form.additionalProperties)
							? form.additionalProperties
							: form.items,
				)
				.find((child) => child !== undefined),
		schema,
	)
}

/**
 * Walks an argument record through a contract's reports and returns the faults the Tool door
 * refuses, empty when the record may proceed to `parse`.
 *
 * @remarks
 * A value `is` accepts returns empty without either report, because `audit` is empty if and only
 * if `is` holds and a guard-valid value always parses. Otherwise every parse fault refuses, and an
 * undeclared key, a `variant` fault, and a `oneOf` fault found by `audit` are reported beside them,
 * so one refusal names them all: a union repairs by declaration order, so a coercion through one is
 * not a repair. Where a union fault covers a path, every fault under that path is left out, because
 * those come from the walk of one arm and can call a key undeclared that another arm declares. A
 * coercible leaf alone does not refuse, unless the audit reached `FAULT_LIMIT`, where its cap can
 * hide an undeclared key. The report holds at most `FAULT_LIMIT` entries.
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
	if (contract.is(value)) return []
	const audited = contract.audit(value)
	const merged = [
		...contract.explain(value),
		...audited.filter(
			(fault) => fault.reason === 'extra' || fault.reason === 'variant' || fault.reason === 'oneOf',
		),
	]
	const faults = [
		...new Map(
			merged.map((fault) => [JSON.stringify([fault.reason, extractPath(fault)]), fault]),
		).values(),
	]
	const covers = faults
		.filter((fault) => fault.reason === 'variant' || fault.reason === 'oneOf')
		.map((fault) => extractPath(fault))
	const uncovered = faults.filter((fault) => {
		const path = extractPath(fault)
		const room = fault.reason === 'variant' || fault.reason === 'oneOf' ? 1 : 0
		return !covers.some(
			(cover) =>
				cover.length + room <= path.length &&
				cover.every((segment, index) => segment === path[index]),
		)
	})
	if (uncovered.length > 0) return limitEntries(uncovered, FAULT_LIMIT)
	return audited.length >= FAULT_LIMIT ? audited : []
}

/**
 * Renders a path as text, encoding what a caller could have sent and eliding the middle of a long
 * one.
 *
 * @remarks
 * A segment that is not a plain identifier is JSON-encoded and length-capped, because a key the
 * caller sent is untrusted text. A path of more than four segments past 120 characters keeps its
 * first segment and its last three.
 *
 * @param path - The segments to render
 * @returns The segments joined with `.`, empty at the root
 *
 * @example
 * ```ts
 * import { renderPath } from '@orkestrel/tool'
 *
 * renderPath(['rows', '0', 'a b']) // 'rows.0."a b"'
 * ```
 */
export function renderPath(path: readonly string[]): string {
	const segments = path.map((segment) =>
		/^[\w$-]{1,64}$/u.test(segment) ? segment : preview(segment),
	)
	const text = segments.join('.')
	return segments.length <= 4 || text.length <= 120
		? text
		: [...segments.slice(0, 1), '…', ...segments.slice(-3)].join('.')
}

/**
 * Renders a list as text, naming at most `REFUSAL_LIST_LIMIT` of its entries and counting the rest.
 *
 * @param entries - The rendered entries
 * @returns The entries joined with `, `
 *
 * @example
 * ```ts
 * import { renderList } from '@orkestrel/tool'
 *
 * renderList(['city', 'units']) // 'city, units'
 * ```
 */
export function renderList(entries: readonly string[]): string {
	const listed = entries.slice(0, REFUSAL_LIST_LIMIT).join(', ')
	return entries.length > REFUSAL_LIST_LIMIT
		? `${listed} and ${String(entries.length - REFUSAL_LIST_LIMIT)} more`
		: listed
}

/**
 * Describes one fault as the line a caller corrects from, naming what to send where the schema
 * says.
 *
 * @remarks
 * Each line opens with the fault's path and reason. An `extra` fault lists the keys declared at
 * its parent, a fault on a literal names its candidates, and each list is bounded. A `variant` or
 * `oneOf` fault says that the value matches none of the declared forms, or several where one must
 * match, and quotes the schema at that path when it fits in `REFUSAL_SCHEMA_LIMIT`.
 *
 * @param fault - The fault to describe
 * @param schema - The compiled schema the fault's path reads
 * @returns The line, with no line break
 *
 * @example
 * ```ts
 * import { describeFaultLine } from '@orkestrel/tool'
 *
 * describeFaultLine({ reason: 'missing', path: ['left'], expected: 'number' }, {}) // 'left: missing; expected number'
 * ```
 */
export function describeFaultLine(fault: AuditFault, schema: JSONSchema): string {
	const path = extractPath(fault)
	const head = `${renderPath(path)}: ${fault.reason}`
	if (fault.reason === 'extra') {
		const keys = extractForms(extractSchema(schema, path.slice(0, -1))).flatMap((form) =>
			Object.keys(form.properties ?? {}),
		)
		return keys.length === 0
			? `${head}; this key is not declared, remove it`
			: `${head}; this key is not declared, remove it or use a declared key: ${renderList(keys.map((key) => renderPath([key])))}`
	}
	const node = extractSchema(schema, path)
	if (fault.reason === 'variant' || fault.reason === 'oneOf') {
		const count = fault.reason === 'variant' ? fault.variants : node?.oneOf?.length
		const forms = count === undefined ? 'the declared forms' : `the ${String(count)} declared forms`
		const claim =
			fault.reason === 'oneOf' && fault.matched > 0
				? `the value matches ${String(fault.matched)} of ${forms} and must match exactly one`
				: `the value matches none of ${forms}`
		const quoted = attempt(() => JSON.stringify(node ?? {}))
		const shown =
			quoted.success && quoted.value.length > 2 && quoted.value.length <= REFUSAL_SCHEMA_LIMIT
				? `: ${quoted.value}`
				: ''
		return `${head}; ${claim}; send it exactly as the schema declares${shown}`
	}
	const candidates =
		fault.expected === 'literal'
			? extractForms(node).flatMap((form) => [
					...(form.enum ?? []).map((value) => preview(value)),
					...(form.type === 'null' ? [preview(null)] : []),
				])
			: []
	return [
		head,
		`expected ${fault.expected}`,
		...('received' in fault ? [`received ${fault.received}`] : []),
		...('constraint' in fault ? [`constraint ${fault.constraint}`] : []),
		...('limit' in fault && fault.limit !== undefined ? [`limit ${String(fault.limit)}`] : []),
		...(candidates.length > 0 ? [`send one of ${renderList(candidates)}`] : []),
	].join('; ')
}

/**
 * Describes a fault report as text a caller corrects from, one fault per line, at most
 * `REFUSAL_TEXT_LIMIT` characters in all.
 *
 * @remarks
 * Each line comes from `describeFaultLine`. The text keeps as many lines as fit and closes by
 * saying how many it left out; a report at `FAULT_LIMIT` also says that it stops there. A refused
 * call's `context.faults` still carries the whole report.
 *
 * @param faults - The faults to describe
 * @param schema - The compiled schema the faults' paths read
 * @returns The refusal message
 *
 * @example
 * ```ts
 * import { describeFaults } from '@orkestrel/tool'
 *
 * describeFaults([{ reason: 'missing', path: ['left'], expected: 'number' }], {}) // 'left: missing; expected number'
 * ```
 */
export function describeFaults(faults: readonly AuditFault[], schema: JSONSchema): string {
	const lines = faults.map((fault) => describeFaultLine(fault, schema))
	const kept = lines.filter(
		(_, index) => lines.slice(0, index + 1).join('\n').length <= REFUSAL_TEXT_LIMIT - 80,
	)
	const hidden = lines.length - kept.length
	const stop = `the report stops at ${String(FAULT_LIMIT)}`
	const parts = [
		...(hidden > 0 ? [`and ${String(hidden)} more faults`] : []),
		...(faults.length >= FAULT_LIMIT ? [stop] : []),
	]
	return [
		...kept,
		...(parts.length > 0 ? [`${parts.join(', ')}; correct these and call again`] : []),
	].join('\n')
}

/**
 * Reads a call's `id`, `name`, and `arguments` once into a plain record, so a guard and every later
 * step see the same values.
 *
 * @remarks
 * A value that is not an object reads as an empty record. A throw from the `arguments` accessor
 * reads as absent, which the guard then refuses with an `id` and `name` to correlate. A throw from
 * the `id` or `name` accessor propagates, because no correlated result can be built without them.
 *
 * @param call - The value the registry received as a call
 * @returns A record holding what each member read
 *
 * @example
 * ```ts
 * import { readCall } from '@orkestrel/tool'
 *
 * readCall({ id: '1', name: 'add', arguments: {} }) // { id: '1', name: 'add', arguments: {} }
 * ```
 */
export function readCall(call: unknown): Readonly<Record<string, unknown>> {
	if (!isObject(call)) return {}
	const id: unknown = Reflect.get(call, 'id')
	const name: unknown = Reflect.get(call, 'name')
	const read = attempt((): unknown => Reflect.get(call, 'arguments'))
	return { id, name, arguments: read.success ? read.value : undefined }
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
