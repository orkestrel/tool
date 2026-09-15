import type { ContractInterface } from '@orkestrel/contract'
import type { ToolAnnotations, ToolContext, ToolInterface, ToolOptions } from '../types.js'
import { createContract, isRecord, isString, schemaToParameters } from '@orkestrel/contract'
import { ToolError } from '../errors.js'

/**
 * Binds an executable tool definition to a handler.
 *
 * @remarks
 * Advertised fields and execution context are forwarded by reference.
 * A contract derives parameters at construction and refuses parse faults before the
 * handler runs, then forwards the parsed arguments; without a contract, arguments
 * retain their identity. Supplying a contract and parameters throws a schema conflict.
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
	readonly #contract?: ContractInterface<unknown>
	readonly #execute: ToolOptions['execute']

	readonly name: string
	readonly title?: string
	readonly description?: string
	readonly summary?: string
	readonly parameters?: Readonly<Record<string, unknown>>
	readonly annotations?: ToolAnnotations

	constructor(options: ToolOptions) {
		if (options.contract !== undefined && options.parameters !== undefined) {
			throw new ToolError('SCHEMA', 'Choose contract or parameters, not both')
		}
		this.name = options.name
		if (options.title !== undefined) this.title = options.title
		if (options.description !== undefined) this.description = options.description
		if (options.summary !== undefined) this.summary = options.summary
		if (options.annotations !== undefined) this.annotations = options.annotations
		if (options.contract !== undefined) {
			this.#contract = createContract(options.contract)
			const parameters = schemaToParameters(this.#contract.schema)
			if (parameters !== undefined) this.parameters = parameters
		} else if (options.parameters !== undefined) this.parameters = options.parameters
		this.#execute = options.execute
	}

	execute(
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<unknown> | unknown {
		const faults = this.#contract?.explain(args) ?? []
		const fault = faults[0]
		if (fault !== undefined) {
			const path = isString(fault.path) ? fault.path : fault.path.join('.')
			let message = `${path}: ${fault.reason}`
			if ('expected' in fault) message += `; expected ${fault.expected}`
			if ('received' in fault) message += `; received ${fault.received}`
			if ('constraint' in fault) message += `; constraint ${fault.constraint}`
			if ('limit' in fault && fault.limit !== undefined) message += `; limit ${fault.limit}`
			if ('variants' in fault) message += `; variants ${fault.variants}`
			if ('matched' in fault) message += `; matched ${fault.matched}`
			throw new ToolError('ARGUMENTS', message, { faults })
		}
		if (this.#contract !== undefined) {
			const parsed = this.#contract.parse(args)
			if (!isRecord(parsed)) throw new ToolError('ARGUMENTS', 'Arguments did not parse')
			return this.#execute(parsed, context)
		}
		return this.#execute(args, context)
	}
}
