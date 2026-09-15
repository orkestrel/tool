import type { ContractShape, Failure, Fault, Success } from '@orkestrel/contract'
import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'

/** Carries the signal and consumer-asserted identity for an execution. */
export interface ToolContext {
	/** Aborts when the caller stops waiting for this call. */
	readonly signal: AbortSignal
	/** Carries consumer-asserted caller identity, forwarded without verification. */
	readonly caller?: unknown
}

/** Describes the observable effects and content of a tool. */
export interface ToolAnnotations {
	/** Reports that the tool changes no state its caller can observe. */
	readonly pure?: boolean
	/** Reports that the tool's value can carry content the tool did not author. */
	readonly untrusted?: boolean
	/** Reports that running the tool has a consequence a caller must confirm. */
	readonly consequential?: boolean
}

/** Identifies a schema conflict or an argument validation failure. */
export type ToolErrorCode = 'SCHEMA' | 'ARGUMENTS'

/** Carries the structured faults behind an argument validation failure. */
export interface ToolErrorContext {
	/** Holds the contract's full parse-fault report. */
	readonly faults?: readonly Fault[]
}

/**
 * Describes a tool as advertised to a caller.
 *
 * @remarks
 * `parameters` is an open JSON Schema record describing the arguments the tool accepts.
 */
export interface ToolDefinition {
	/** Identifies the tool a caller selects. */
	readonly name: string
	/** Holds a display title for the tool. */
	readonly title?: string
	/** Describes the tool's behavior. */
	readonly description?: string
	/** Holds the JSON Schema for the tool's arguments. */
	readonly parameters?: Readonly<Record<string, unknown>>
	/** Describes the tool's observable effects and content. */
	readonly annotations?: ToolAnnotations
}

/**
 * Describes one request to run a named tool.
 *
 * @remarks
 * `id` correlates the call with its later {@link ToolResult}. `arguments` is the
 * caller-supplied arguments record. Execution context travels separately from this
 * JSON call envelope.
 */
export interface ToolCall {
	/** Correlates this call with its result. */
	readonly id: string
	/** Selects the tool to execute. */
	readonly name: string
	/** Carries the record the caller supplied. */
	readonly arguments: Readonly<Record<string, unknown>>
}

/**
 * Reports the successful outcome of executing a {@link ToolCall}.
 *
 * @remarks
 * `value` is whatever the handler returned — including `undefined`, `null`, `0`,
 * `''`, or `false`. A present value never implies a meaningful one.
 */
export interface ToolSuccess extends Success<unknown> {
	/** Identifies the corresponding call. */
	readonly id: string
	/** Identifies the called tool. */
	readonly name: string
}

/**
 * Reports the failed outcome of executing a {@link ToolCall}.
 *
 * @remarks
 * `error` is the failure message: an unknown tool name, an `Error`'s message, or
 * a String-converted throw. The registry carries no further structure. An
 * in-process caller needing a typed error calls `tools.tool(name)`, then
 * `tool.execute(args, context)` in its own `try`/`catch`.
 */
export interface ToolFailure extends Failure<string> {
	/** Identifies the corresponding call. */
	readonly id: string
	/** Identifies the called tool. */
	readonly name: string
}

/**
 * Represents the outcome of executing a {@link ToolCall}.
 *
 * @remarks
 * Always a result and never a throw for a call whose members are plain values. A call
 * whose `id` or `name` accessor throws when read makes `execute` reject instead, because
 * no correlated result can be built without them. Narrow on `success`.
 */
export type ToolResult = ToolSuccess | ToolFailure

/**
 * Represents an executable tool: its advertised definition plus its local handler.
 *
 * @remarks
 * `summary`, when present, is advertised in place of the full `description` by a
 * {@link ToolManagerInterface}. The full description remains available on the tool.
 */
export interface ToolInterface extends ToolDefinition {
	/** Holds a concise description to advertise in place of the full description. */
	readonly summary?: string
	/**
	 * Runs the tool's handler with the caller-supplied arguments and execution context.
	 *
	 * @remarks
	 * Failures are not contained here: a synchronous throw propagates and an
	 * asynchronous rejection rejects. {@link ToolManagerInterface.execute} is where a
	 * call becomes a result. A configured contract refuses arguments with parse faults
	 * before the handler runs, then forwards `contract.parse(args)`, an owned,
	 * normalized copy in the schema's types with undeclared keys dropped; without a
	 * contract, the raw record is forwarded unchanged.
	 * Caller identity is forwarded without verification.
	 * The second parameter is the execution context; caller identity is `context.caller`.
	 * `Tool.execute` refuses nothing on an aborted signal; the manager checks the signal
	 * before entry, and a direct caller who passes an aborted signal gets a handler that observes it.
	 *
	 * @param args - The caller-supplied arguments record
	 * @param context - The required signal and optional consumer-asserted caller identity
	 * @returns The tool's synchronous or asynchronous result
	 */
	execute(args: Readonly<Record<string, unknown>>, context: ToolContext): Promise<unknown> | unknown
}

/**
 * Configures an executable tool.
 *
 * @remarks
 * `name` identifies the tool, `description` and `parameters` define what is advertised
 * to a caller, `summary` optionally replaces the advertised description, and `execute`
 * handles the caller-supplied arguments record and execution context. `contract`
 * derives the advertised parameters and checks arguments with `explain`; supplying
 * `parameters` alongside `contract` throws a `ToolError` with code `SCHEMA`.
 */
export interface ToolOptions {
	/** Identifies the tool a caller selects. */
	readonly name: string
	/** Holds a display title for the tool. */
	readonly title?: string
	/** Describes the tool's behavior in full. */
	readonly description?: string
	/** Holds a concise description to advertise in place of the full description. */
	readonly summary?: string
	/** Holds the JSON Schema for the tool's arguments. */
	readonly parameters?: Readonly<Record<string, unknown>>
	/** Derives parameters and validates arguments before execution. */
	readonly contract?: ContractShape
	/** Describes the tool's observable effects and content. */
	readonly annotations?: ToolAnnotations
	/**
	 * Handles the arguments and required execution context.
	 *
	 * @remarks
	 * The second parameter is the execution context; caller identity is `context.caller`.
	 */
	readonly execute: (
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	) => Promise<unknown> | unknown
}

/**
 * Names the events a tool registry publishes.
 *
 * @remarks
 * Each event describes the registry at the moment it is published. A listener that
 * mutates the registry re-enters synchronously; its events publish before the outer
 * call resumes.
 */
export type ToolManagerEventMap = {
	/** Fires after a tool is registered, with the registered instance. */
	readonly add: readonly [tool: ToolInterface]
	/**
	 * Fires after a tool is removed, with the removed instance.
	 *
	 * @remarks
	 * A replacement publishes this event with the replacement already installed.
	 * A listener must not read absence from the map to confirm a removal.
	 */
	readonly remove: readonly [tool: ToolInterface]
	/** Fires once per `clear`, with the tools it removed in registration order. */
	readonly clear: readonly [tools: readonly ToolInterface[]]
}

/** Configures a tool registry's initial listeners and error handling. */
export interface ToolManagerOptions {
	/** Registers the initial listeners for registry changes. */
	readonly on?: EmitterHooks<ToolManagerEventMap>
	/** Receives listener throws with the event name, without interrupting sibling listeners. */
	readonly error?: EmitterErrorHandler
}

/**
 * Represents a registry of executable tools with per-call error isolation.
 *
 * @remarks
 * Tools are keyed by name in insertion order. Adding an existing name overwrites its
 * value without changing its position. Every call whose members are plain values
 * resolves to a {@link ToolResult}; missing tools and thrown handlers become error
 * results, and a call whose `id` or `name` accessor throws when read makes `execute`
 * reject instead. Batch execution preserves input order.
 * Registry changes publish synchronously through the owned emitter. A replacement
 * publishes `remove` for the previous instance, then `add` if the map still holds
 * that exact replacement after the removal listeners return.
 * A destroyed registry publishes nothing; later additions still update its tool map.
 */
export interface ToolManagerInterface {
	/** Reports how many tools are registered. */
	readonly count: number
	/** Publishes the registry's `add`, `remove`, and `clear` events. */
	readonly emitter: EmitterInterface<ToolManagerEventMap>
	/**
	 * Registers one tool.
	 *
	 * @param tool - The tool to register
	 * @returns Nothing
	 */
	add(tool: ToolInterface): void
	/**
	 * Registers a batch of tools.
	 *
	 * @param tools - The tools to register
	 * @returns Nothing
	 */
	add(tools: readonly ToolInterface[]): void
	/**
	 * Finds one registered tool by name.
	 *
	 * @param name - The registered tool name
	 * @returns The exact registered instance when found, otherwise `undefined`
	 */
	tool(name: string): ToolInterface | undefined
	/**
	 * Lists the registered tools in insertion order.
	 *
	 * @returns A new readonly array of registered tools
	 */
	tools(): readonly ToolInterface[]
	/**
	 * Lists the definitions advertised to a caller.
	 *
	 * @remarks
	 * The projected `description` is the tool's `summary` when one was authored,
	 * advertised in place of the full description. The full text stays on the tool
	 * for direct lookup.
	 *
	 * @returns A new readonly array of tool definitions
	 */
	definitions(): readonly ToolDefinition[]
	/**
	 * Executes one call with error isolation.
	 *
	 * @param call - The tool call to execute
	 * @param context - The execution context; omission creates a non-aborted signal
	 * @returns The correlated result
	 */
	execute(call: ToolCall, context?: ToolContext): Promise<ToolResult>
	/**
	 * Executes a batch of calls with per-call error isolation.
	 *
	 * @param calls - The tool calls to execute
	 * @param context - The shared execution context; omission creates a non-aborted signal
	 * @returns The correlated results in input order
	 */
	execute(calls: readonly ToolCall[], context?: ToolContext): Promise<readonly ToolResult[]>
	/**
	 * Removes one registered tool.
	 *
	 * @param name - The tool name to remove
	 * @returns True if the tool was present; false otherwise
	 */
	remove(name: string): boolean
	/**
	 * Removes a batch of registered tools.
	 *
	 * @param names - The tool names to remove
	 * @returns True if every named tool was present; false otherwise
	 */
	remove(names: readonly string[]): boolean
	/**
	 * Removes every registered tool.
	 *
	 * @returns Nothing
	 */
	clear(): void
	/**
	 * Removes every tool and releases the emitter's listeners.
	 *
	 * @remarks
	 * Publishes `clear` before destroying the emitter. A destroyed registry publishes
	 * nothing, including when a later `add` updates its tool map.
	 * Returns with an empty registry even if a `clear` listener adds a tool.
	 * An emission already underway delivers to its remaining snapshotted listeners,
	 * even when a listener destroys the registry before its siblings run.
	 *
	 * @returns Nothing
	 */
	destroy(): void
}
