/**
 * A tool definition advertised to a model.
 *
 * @remarks
 * `parameters` is an open JSON Schema record describing the arguments the tool accepts.
 */
export interface ToolDefinition {
	/** The name the model uses to select the tool. */
	readonly name: string
	/** A description of the tool's behavior. */
	readonly description?: string
	/** The JSON Schema for the tool's arguments. */
	readonly parameters?: Readonly<Record<string, unknown>>
}

/**
 * A tool call emitted by a model.
 *
 * @remarks
 * `id` correlates the call with its later {@link ToolResult}. `arguments` is the
 * model-supplied arguments record.
 */
export interface ToolCall {
	/** The identifier that correlates this call with its result. */
	readonly id: string
	/** The name of the tool to execute. */
	readonly name: string
	/** The model-supplied arguments record. */
	readonly arguments: Readonly<Record<string, unknown>>
}

/**
 * The outcome of executing a {@link ToolCall}.
 *
 * @remarks
 * A successful result carries `value`; a failed result carries `error`.
 */
export interface ToolResult {
	/** The identifier of the corresponding call. */
	readonly id: string
	/** The name of the called tool. */
	readonly name: string
	/** The successful return value. */
	readonly value?: unknown
	/** The failure message. */
	readonly error?: string
}

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
	 * @param args - The model-supplied arguments record
	 * @returns The tool's synchronous or asynchronous result
	 */
	execute(args: Readonly<Record<string, unknown>>): Promise<unknown> | unknown
}

/**
 * Options for creating an executable tool.
 *
 * @remarks
 * `name` identifies the tool, `description` and `parameters` define what a provider
 * advertises to the model, `summary` optionally replaces the advertised description,
 * and `execute` handles the model-supplied arguments record.
 */
export interface ToolOptions {
	/** The name the model uses to select the tool. */
	readonly name: string
	/** The full description of the tool's behavior. */
	readonly description?: string
	/** A concise description to advertise in place of the full description. */
	readonly summary?: string
	/** The JSON Schema for the tool's arguments. */
	readonly parameters?: Readonly<Record<string, unknown>>
	/** The handler that executes the tool. */
	readonly execute: (args: Readonly<Record<string, unknown>>) => Promise<unknown> | unknown
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
	 * List the definitions advertised to a model.
	 *
	 * @returns A new readonly array of tool definitions
	 */
	definitions(): readonly ToolDefinition[]
	/**
	 * Execute one call with error isolation.
	 *
	 * @param call - The tool call to execute
	 * @returns The correlated result
	 */
	execute(call: ToolCall): Promise<ToolResult>
	/**
	 * Execute a batch of calls with per-call error isolation.
	 *
	 * @param calls - The tool calls to execute
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
	 * @returns Whether any named tool was present
	 */
	remove(names: readonly string[]): boolean
	/**
	 * Remove every registered tool.
	 *
	 * @returns Nothing
	 */
	clear(): void
}
