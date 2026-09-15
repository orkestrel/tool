import type {
	ToolCall,
	ToolContext,
	ToolDefinition,
	ToolInterface,
	ToolManagerInterface,
	ToolResult,
} from '../types.js'
import { attempt, isArray } from '@orkestrel/contract'
import { toolToDefinition } from '../helpers.js'

/**
 * Represents an insertion-ordered tool registry with per-call error isolation.
 *
 * @remarks
 * A repeated name overwrites the registered tool without changing its insertion
 * position. Definitions advertise `summary` in place of `description` when present.
 * Unknown names and handler throws resolve to error results; a call whose `id` or `name`
 * accessor throws when read makes its call, and the batch holding it, reject. Batch
 * execution preserves input order and isolates each call whose members are plain
 * values. Execution context is shared across a batch and forwarded unchanged. An
 * omitted context receives a non-aborted signal. A signal aborted before handler
 * entry produces an error result; later cancellation is the handler's responsibility.
 *
 * @example
 * ```ts
 * import { Tool, ToolManager } from '@orkestrel/tool'
 *
 * const tools = new ToolManager()
 * tools.add(new Tool({ name: 'add', execute: (args) => Number(args.x) + Number(args.y) }))
 * const result = await tools.execute({
 * 	id: '1',
 * 	name: 'add',
 * 	arguments: { x: 1, y: 2 },
 * })
 * ```
 */
export class ToolManager implements ToolManagerInterface {
	readonly #tools = new Map<string, ToolInterface>()

	get count(): number {
		return this.#tools.size
	}

	add(tool: ToolInterface): void
	add(tools: readonly ToolInterface[]): void
	add(tools: ToolInterface | readonly ToolInterface[]): void {
		if (isArray(tools)) {
			for (const tool of tools) this.#tools.set(tool.name, tool)
			return
		}
		this.#tools.set(tools.name, tools)
	}

	tool(name: string): ToolInterface | undefined {
		return this.#tools.get(name)
	}

	tools(): readonly ToolInterface[] {
		return [...this.#tools.values()]
	}

	definitions(): readonly ToolDefinition[] {
		return [...this.#tools.values()].map((tool) => toolToDefinition(tool))
	}

	execute(call: ToolCall, context?: ToolContext): Promise<ToolResult>
	execute(calls: readonly ToolCall[], context?: ToolContext): Promise<readonly ToolResult[]>
	execute(
		call: ToolCall | readonly ToolCall[],
		context: ToolContext = { signal: new AbortController().signal },
	): Promise<ToolResult | readonly ToolResult[]> {
		if (isArray(call)) return Promise.all(call.map((one) => this.#run(one, context)))
		return this.#run(call, context)
	}

	remove(name: string): boolean
	remove(names: readonly string[]): boolean
	remove(names: string | readonly string[]): boolean {
		if (isArray(names)) {
			let removed = true
			for (const name of names) {
				if (!this.#tools.delete(name)) removed = false
			}
			return removed
		}
		return this.#tools.delete(names)
	}

	clear(): void {
		this.#tools.clear()
	}

	async #run(call: ToolCall, context: ToolContext): Promise<ToolResult> {
		const tool = this.#tools.get(call.name)
		if (tool === undefined) {
			return {
				id: call.id,
				name: call.name,
				success: false,
				error: `tool not found: ${call.name}`,
			}
		}
		try {
			if (context.signal.aborted) {
				const reason: unknown = context.signal.reason
				return {
					id: call.id,
					name: call.name,
					success: false,
					error: reason === undefined ? 'aborted' : String(reason),
				}
			}
			const value = await tool.execute(call.arguments, context)
			return { id: call.id, name: call.name, success: true, value }
		} catch (error) {
			const message = attempt(() =>
				error instanceof Error ? String(error.message) : String(error),
			)
			return {
				id: call.id,
				name: call.name,
				success: false,
				error: message.success ? message.value : 'Unknown thrown value',
			}
		}
	}
}
