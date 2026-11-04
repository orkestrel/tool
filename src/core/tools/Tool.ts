import type { ContractInterface } from '@orkestrel/contract'
import type { ToolAnnotations, ToolContext, ToolInterface, ToolOptions } from '../types.js'
import {
	attempt,
	createContract,
	isRecord,
	isString,
	preview,
	schemaToParameters,
	schemaToShape,
} from '@orkestrel/contract'
import { CLOSED_PARAMETERS, OPEN_PARAMETERS } from '../constants.js'
import { ToolError } from '../errors.js'
import { describeFaults, scanFaults } from '../helpers.js'

/**
 * Binds an executable tool definition to a handler.
 *
 * @remarks
 * Advertised fields and execution context are forwarded by reference. Every call runs the door
 * before the handler: a parse fault, an undeclared key of a closed object, a report at
 * `FAULT_LIMIT`, and a union fault each throw a `ToolError` with code `ARGUMENTS`, and `parse`
 * hands the handler an owned copy. A contract compiles at construction and derives the advertised
 * parameters. A `parameters` record is advertised verbatim and compiles through the lenient
 * `schemaToShape` on the first `execute`, where a conversion failure throws code `SCHEMA`. With
 * neither, the tool advertises and enforces {@link CLOSED_PARAMETERS}. `strict: false` skips the
 * door and forwards the arguments' identity. Supplying a contract and parameters, or a `name` that
 * is not a non-empty trimmed string, throws code `SCHEMA`. Caller context is consumer-asserted and
 * is not verified. Handler failures are not caught here; {@link ToolManager} owns per-call error
 * isolation.
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
 * 		required: ['a', 'b'],
 * 	},
 * 	execute: (args) => Number(args.a) + Number(args.b),
 * })
 * ```
 */
export class Tool implements ToolInterface {
	readonly #strict: boolean
	readonly #execute: ToolOptions['execute']
	#contract?: ContractInterface<unknown>

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
		const name: unknown = options.name
		if (!isString(name) || name.length === 0 || name !== name.trim()) {
			throw new ToolError(
				'SCHEMA',
				`A tool name must be a non-empty string with no surrounding space; received ${preview(name)}`,
			)
		}
		this.#strict = options.strict !== false
		this.name = options.name
		if (options.title !== undefined) this.title = options.title
		if (options.description !== undefined) this.description = options.description
		if (options.summary !== undefined) this.summary = options.summary
		if (options.annotations !== undefined) this.annotations = options.annotations
		if (options.contract !== undefined) {
			const contract = createContract(options.contract)
			if (this.#strict) this.#contract = contract
			const parameters = schemaToParameters(contract.schema)
			if (parameters !== undefined) this.parameters = parameters
		} else if (options.parameters !== undefined) this.parameters = options.parameters
		else this.parameters = this.#strict ? CLOSED_PARAMETERS : OPEN_PARAMETERS
		this.#execute = options.execute
	}

	execute(
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<unknown> | unknown {
		if (!this.#strict) return this.#execute(args, context)
		const contract = this.#compile()
		const faults = scanFaults(contract, args)
		if (faults.length > 0) throw new ToolError('ARGUMENTS', describeFaults(faults), { faults })
		const parsed = contract.parse(args)
		if (!isRecord(parsed)) {
			throw new ToolError(
				'ARGUMENTS',
				'Arguments did not parse to a record; send one JSON object holding the declared keys',
			)
		}
		return this.#execute(parsed, context)
	}

	#compile(): ContractInterface<unknown> {
		if (this.#contract !== undefined) return this.#contract
		const compiled = attempt(() =>
			createContract(schemaToShape(this.parameters ?? CLOSED_PARAMETERS)),
		)
		if (!compiled.success) {
			throw new ToolError(
				'SCHEMA',
				`Tool ${preview(this.name)} cannot compile its parameters schema; pass a JSON Schema built from plain values, or set strict: false to forward arguments unchecked`,
				undefined,
				{ cause: compiled.error },
			)
		}
		this.#contract = compiled.value
		return compiled.value
	}
}
