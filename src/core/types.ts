import type { Failure, Success } from '@orkestrel/contract'

/**
 * Describes a tool as advertised to a caller.
 *
 * @remarks
 * `parameters` is an open JSON Schema record describing the arguments the tool accepts.
 */
export interface ToolDefinition {
	/** Identifies the tool a caller selects. */
	readonly name: string
	/** Describes the tool's behavior. */
	readonly description?: string
	/** Holds the JSON Schema for the tool's arguments. */
	readonly parameters?: Readonly<Record<string, unknown>>
}

/**
 * Describes a call issued by a caller.
 *
 * @remarks
 * `id` correlates the call with its later {@link ToolResult}. `arguments` is the
 * caller-supplied arguments record. `caller` is optional consumer-asserted context:
 * this package forwards it without verification, so the tool or its policy layer owns
 * every trust decision.
 */
export interface ToolCall {
	/** Correlates this call with its result. */
	readonly id: string
	/** Selects the tool to execute. */
	readonly name: string
	/** Carries the record the caller supplied. */
	readonly arguments: Readonly<Record<string, unknown>>
	/** Carries consumer-asserted context, forwarded without verification. */
	readonly caller?: unknown
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
 * `tool.execute(args)` in its own `try`/`catch`.
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
	 * Runs the tool's handler.
	 *
	 * @remarks
	 * Failures are not contained here: a synchronous throw propagates and an
	 * asynchronous rejection rejects. {@link ToolManagerInterface.execute} is where a
	 * call becomes a result. The registry omits `caller` from the invocation when the
	 * call carries none, so a handler reading its own arity sees one argument.
	 *
	 * @param args - The caller-supplied arguments record
	 * @param caller - Optional consumer-asserted caller context, forwarded without verification
	 * @returns The tool's synchronous or asynchronous result
	 */
	execute(args: Readonly<Record<string, unknown>>, caller?: unknown): Promise<unknown> | unknown
}

/**
 * Configures an executable tool.
 *
 * @remarks
 * `name` identifies the tool, `description` and `parameters` define what is advertised
 * to a caller, `summary` optionally replaces the advertised description, and `execute`
 * handles the caller-supplied arguments record plus optional consumer-asserted caller
 * context. This package forwards that context without verification.
 */
export interface ToolOptions {
	/** Identifies the tool a caller selects. */
	readonly name: string
	/** Describes the tool's behavior in full. */
	readonly description?: string
	/** Holds a concise description to advertise in place of the full description. */
	readonly summary?: string
	/** Holds the JSON Schema for the tool's arguments. */
	readonly parameters?: Readonly<Record<string, unknown>>
	/** Handles the arguments and optional unverified caller context. */
	readonly execute: (
		args: Readonly<Record<string, unknown>>,
		caller?: unknown,
	) => Promise<unknown> | unknown
}

/**
 * Represents a registry of executable tools with per-call error isolation.
 *
 * @remarks
 * Tools are keyed by name in insertion order. Adding an existing name overwrites its
 * value without changing its position. Every call whose members are plain values
 * resolves to a {@link ToolResult}; missing tools and thrown handlers become error
 * results, and a call whose `id` or `name` accessor throws when read makes `execute`
 * reject instead. Batch execution preserves input order and isolates each such call.
 */
export interface ToolManagerInterface {
	/** Reports how many tools are registered. */
	readonly count: number
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
	 * @returns The tool when found, otherwise `undefined`
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
	 * @param call - The tool call to execute, including optional caller context
	 * @returns The correlated result
	 */
	execute(call: ToolCall): Promise<ToolResult>
	/**
	 * Executes a batch of calls with per-call error isolation.
	 *
	 * @param calls - The tool calls to execute, including optional caller context
	 * @returns The correlated results in input order
	 */
	execute(calls: readonly ToolCall[]): Promise<readonly ToolResult[]>
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
}
