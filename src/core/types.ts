import type { Failure, Success } from '@orkestrel/contract'

/**
 * A tool definition advertised to a caller.
 *
 * @remarks
 * `parameters` is an open JSON Schema record describing the arguments the tool accepts.
 */
export interface ToolDefinition {
	/** The name a caller uses to select the tool. */
	readonly name: string
	/** A description of the tool's behavior. */
	readonly description?: string
	/** The JSON Schema for the tool's arguments. */
	readonly parameters?: Readonly<Record<string, unknown>>
}

/**
 * A tool call issued by a caller.
 *
 * @remarks
 * `id` correlates the call with its later {@link ToolResult}. `arguments` is the
 * caller-supplied arguments record. `caller` is optional consumer-asserted context:
 * this package forwards it without verification, so the tool or its policy layer owns
 * every trust decision.
 */
export interface ToolCall {
	/** The identifier that correlates this call with its result. */
	readonly id: string
	/** The name of the tool to execute. */
	readonly name: string
	/** The caller-supplied arguments record. */
	readonly arguments: Readonly<Record<string, unknown>>
	/** Consumer-asserted caller context, forwarded without verification. */
	readonly caller?: unknown
}

/**
 * The successful outcome of executing a {@link ToolCall}.
 *
 * @remarks
 * `value` is whatever the handler returned — including `undefined`, `null`, `0`,
 * `''`, or `false`. A present value never implies a meaningful one.
 */
export interface ToolSuccess extends Success<unknown> {
	/** The identifier of the corresponding call. */
	readonly id: string
	/** The name of the called tool. */
	readonly name: string
}

/**
 * The failed outcome of executing a {@link ToolCall}.
 *
 * @remarks
 * `error` is the failure message: an unknown tool name, an `Error`'s message, or
 * a String-converted throw. The registry carries no further structure. An
 * in-process caller needing a typed error calls `tools.tool(name)`, then
 * `tool.execute(args)` in its own `try`/`catch`.
 */
export interface ToolFailure extends Failure<string> {
	/** The identifier of the corresponding call. */
	readonly id: string
	/** The name of the called tool. */
	readonly name: string
}

/**
 * The outcome of executing a {@link ToolCall}.
 *
 * @remarks
 * Always a result and never a throw. Narrow on `success`.
 */
export type ToolResult = ToolSuccess | ToolFailure

/**
 * An executable tool: its advertised definition plus its local handler.
 *
 * @remarks
 * `summary`, when present, is advertised in place of the full `description` by a
 * {@link ToolManagerInterface}. The full description remains available on the tool.
 */
export interface ToolInterface extends ToolDefinition {
	/** A concise description to advertise in place of the full description. */
	readonly summary?: string
	/**
	 * Execute the tool.
	 *
	 * @param args - The caller-supplied arguments record
	 * @param caller - Optional consumer-asserted caller context, forwarded without verification
	 * @returns The tool's synchronous or asynchronous result
	 */
	execute(args: Readonly<Record<string, unknown>>, caller?: unknown): Promise<unknown> | unknown
}

/**
 * Options for creating an executable tool.
 *
 * @remarks
 * `name` identifies the tool, `description` and `parameters` define what is advertised
 * to a caller, `summary` optionally replaces the advertised description, and `execute`
 * handles the caller-supplied arguments record plus optional consumer-asserted caller
 * context. This package forwards that context without verification.
 */
export interface ToolOptions {
	/** The name a caller uses to select the tool. */
	readonly name: string
	/** The full description of the tool's behavior. */
	readonly description?: string
	/** A concise description to advertise in place of the full description. */
	readonly summary?: string
	/** The JSON Schema for the tool's arguments. */
	readonly parameters?: Readonly<Record<string, unknown>>
	/** The handler that receives arguments and optional unverified caller context. */
	readonly execute: (
		args: Readonly<Record<string, unknown>>,
		caller?: unknown,
	) => Promise<unknown> | unknown
}

/**
 * A registry of executable tools with per-call error isolation.
 *
 * @remarks
 * Tools are keyed by name in insertion order. Adding an existing name overwrites its
 * value without changing its position. Every call resolves to a {@link ToolResult};
 * missing tools and thrown handlers become error results. Batch execution preserves
 * input order and isolates each call.
 */
export interface ToolManagerInterface {
	/** The number of registered tools. */
	readonly count: number
	/**
	 * Register one tool.
	 *
	 * @param tool - The tool to register
	 * @returns Nothing
	 */
	add(tool: ToolInterface): void
	/**
	 * Register a batch of tools.
	 *
	 * @param tools - The tools to register
	 * @returns Nothing
	 */
	add(tools: readonly ToolInterface[]): void
	/**
	 * Find one registered tool by name.
	 *
	 * @param name - The registered tool name
	 * @returns The tool when found, otherwise `undefined`
	 */
	tool(name: string): ToolInterface | undefined
	/**
	 * List the registered tools in insertion order.
	 *
	 * @returns A new readonly array of registered tools
	 */
	tools(): readonly ToolInterface[]
	/**
	 * List the definitions advertised to a caller.
	 *
	 * The projected `description` is the tool's `summary` when one was authored,
	 * advertised in place of the full description. The full text stays on the tool
	 * for direct lookup.
	 *
	 * @returns A new readonly array of tool definitions
	 */
	definitions(): readonly ToolDefinition[]
	/**
	 * Execute one call with error isolation.
	 *
	 * @param call - The tool call to execute, including optional caller context
	 * @returns The correlated result
	 */
	execute(call: ToolCall): Promise<ToolResult>
	/**
	 * Execute a batch of calls with per-call error isolation.
	 *
	 * @param calls - The tool calls to execute, including optional caller context
	 * @returns The correlated results in input order
	 */
	execute(calls: readonly ToolCall[]): Promise<readonly ToolResult[]>
	/**
	 * Remove one registered tool.
	 *
	 * @param name - The tool name to remove
	 * @returns Whether the tool was present
	 */
	remove(name: string): boolean
	/**
	 * Remove a batch of registered tools.
	 *
	 * @param names - The tool names to remove
	 * @returns True if every named tool was present; false otherwise
	 */
	remove(names: readonly string[]): boolean
	/**
	 * Remove every registered tool.
	 *
	 * @returns Nothing
	 */
	clear(): void
}
