import type { ToolDefinition, ToolInterface } from './types.js'

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
 * const echo = new Tool({ name: 'echo', summary: 'Echo a value.', execute: (args) => args.value })
 * toolToDefinition(echo) // { name: 'echo', description: 'Echo a value.' }
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
