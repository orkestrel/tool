import type { ToolInterface, ToolManagerInterface, ToolOptions } from './types.js'
import { Tool } from './tools/Tool.js'
import { ToolManager } from './tools/ToolManager.js'

/**
 * Creates an executable tool bound to the supplied handler, returned as a
 * `ToolInterface` so a call site holds the published contract rather than the `Tool`
 * class.
 *
 * @param options - The advertised definition and execution handler
 * @returns A tool bound to the supplied handler
 *
 * @example Anatomy of a tool
 * ```ts
 * import { createTool } from '@orkestrel/tool'
 *
 * const add = createTool({
 * 	name: 'add',
 * 	description: 'Add two numeric values and return their sum. Both operands are required.',
 * 	summary: 'Add two numbers.',
 * 	parameters: {
 * 		type: 'object',
 * 		properties: {
 * 			left: { type: 'number' },
 * 			right: { type: 'number' },
 * 		},
 * 		required: ['left', 'right'],
 * 	},
 * 	execute: (args) => Number(args.left) + Number(args.right),
 * })
 * ```
 */
export function createTool(options: ToolOptions): ToolInterface {
	return new Tool(options)
}

/**
 * Creates an empty registry that advertises definitions and executes calls with
 * per-call error isolation, returned as a `ToolManagerInterface` so a caller holds the
 * published contract rather than the `ToolManager` class.
 *
 * @returns A registry bound to no tools
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
