import type { ToolDefinition, ToolInterface } from './types.js'

/**
 * Projects a tool onto the plain definition advertised to a caller.
 *
 * @remarks
 * The projection is a fresh object carrying `name`, then `description` only when the
 * tool authored a summary or a description, then `parameters` only when the tool
 * authored a schema. An authored `summary` is advertised in place of the full
 * `description`, which stays on the tool for direct lookup. The parameter schema is
 * copied by reference and never cloned, so the definition is never a live handle on
 * the tool's handler.
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
	const definition: {
		name: string
		description?: string
		parameters?: Readonly<Record<string, unknown>>
	} = {
		name: tool.name,
	}
	const description = tool.summary ?? tool.description
	if (description !== undefined) definition.description = description
	if (tool.parameters !== undefined) definition.parameters = tool.parameters
	return definition
}
