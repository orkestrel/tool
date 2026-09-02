import type { ToolInterface, ToolManagerInterface, ToolOptions } from './types.js'
import { Tool } from './tools/Tool.js'
import { ToolManager } from './tools/ToolManager.js'

/**
 * Creates an executable tool.
 *
 * @param options - The advertised definition and execution handler
 * @returns A tool bound to the supplied handler
 *
 * @example
 * ```ts
 * import { createTool } from '@orkestrel/tool'
 *
 * const add = createTool({
 * 	name: 'add',
 * 	description: 'Add two numbers',
 * 	execute: (args) => Number(args.a) + Number(args.b),
 * })
 * ```
 */
export function createTool(options: ToolOptions): ToolInterface {
	return new Tool(options)
}

/**
 * Creates an empty tool registry.
 *
 * @returns A registry that advertises definitions and executes calls with per-call
 * error isolation
 *
 * @example
 * ```ts
 * import { createTool, createToolManager } from '@orkestrel/tool'
 *
 * const tools = createToolManager()
 * tools.add(createTool({ name: 'echo', execute: (args) => args.value }))
 * const result = await tools.execute({
 * 	id: '1',
 * 	name: 'echo',
 * 	arguments: { value: 'hello' },
 * })
 * ```
 */
export function createToolManager(): ToolManagerInterface {
	return new ToolManager()
}
