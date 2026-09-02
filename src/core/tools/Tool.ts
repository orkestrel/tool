import type { ToolInterface, ToolOptions } from '../types.js'

/**
 * Binds an executable tool definition to a handler.
 *
 * @remarks
 * Schema fields, arguments, and present caller context are forwarded by reference.
 * Caller context is consumer-asserted and is not verified. Handler failures are not
 * caught here; {@link ToolManager} owns per-call error isolation.
 *
 * @example
 * ```ts
 * import { Tool } from '@orkestrel/tool'
 *
 * const tool = new Tool({
 * 	name: 'add',
 * 	description: 'Add two numbers',
 * 	parameters: {
 * 		type: 'object',
 * 		properties: { a: { type: 'number' }, b: { type: 'number' } },
 * 	},
 * 	execute: (args) => Number(args.a) + Number(args.b),
 * })
 * ```
 */
export class Tool implements ToolInterface {
	readonly name: string
	readonly description?: string
	readonly summary?: string
	readonly parameters?: Readonly<Record<string, unknown>>
	readonly #execute: (
		args: Readonly<Record<string, unknown>>,
		caller?: unknown,
	) => Promise<unknown> | unknown

	constructor(options: ToolOptions) {
		this.name = options.name
		if (options.description !== undefined) this.description = options.description
		if (options.summary !== undefined) this.summary = options.summary
		if (options.parameters !== undefined) this.parameters = options.parameters
		this.#execute = options.execute
	}

	execute(args: Readonly<Record<string, unknown>>, caller?: unknown): Promise<unknown> | unknown {
		if (caller === undefined) return this.#execute(args)
		return this.#execute(args, caller)
	}
}
