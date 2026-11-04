import type { ToolDefinition, ToolFailure, ToolInterface } from './types.js'
import { attempt, isObject, isString } from '@orkestrel/contract'

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
 * Projects a `parameters` record onto the schema its door compiles, reading a root with
 * `properties` and no `type` as an object, because a tool's arguments are always a record.
 *
 * @remarks
 * Without this the lenient conversion reads such a root as a union that also admits non-objects,
 * so a coercion through it refuses and its inner faults are left out. The record itself stays as
 * it was given, and it is what the tool advertises. A nested node keeps its conversion, because a
 * nested value can hold a non-object.
 *
 * @param parameters - The record the tool advertises
 * @returns The schema to compile: a fresh object for a typeless root, otherwise the record itself
 *
 * @example
 * ```ts
 * import { parametersToSchema } from '@orkestrel/tool'
 *
 * parametersToSchema({ properties: {} }) // { type: 'object', properties: {} }
 * ```
 */
export function parametersToSchema(
	parameters: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return Object.hasOwn(parameters, 'properties') && !Object.hasOwn(parameters, 'type')
		? { type: 'object', ...parameters }
		: parameters
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
