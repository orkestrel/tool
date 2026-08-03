import type {
	ToolCall,
	ToolDefinition,
	ToolInterface,
	ToolManagerInterface,
	ToolResult,
} from '../types.js'
import { attempt, isArray } from '@orkestrel/contract'

/**
 * An insertion-ordered tool registry with per-call error isolation.
 *
 * @remarks
 * A repeated name overwrites the registered tool without changing its insertion
 * position. Definitions advertise `summary` in place of `description` when present.
 * Unknown names and handler throws resolve to error results; batch execution preserves
 * input order and never fails as a whole because of an individual call. Optional
 * consumer-asserted caller context is forwarded without verification.
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
		return [...this.#tools.values()].map((tool) => this.#definition(tool))
	}

	execute(call: ToolCall): Promise<ToolResult>
	execute(calls: readonly ToolCall[]): Promise<readonly ToolResult[]>
	execute(call: ToolCall | readonly ToolCall[]): Promise<ToolResult | readonly ToolResult[]> {
		if (isArray(call)) return Promise.all(call.map((one) => this.#run(one)))
		return this.#run(call)
	}

	remove(name: string): boolean
	remove(names: readonly string[]): boolean
	remove(names: string | readonly string[]): boolean {
		if (isArray(names)) {
			let removed = false
			for (const name of names) {
				if (this.#tools.delete(name)) removed = true
			}
			return removed
		}
		return this.#tools.delete(names)
	}

	clear(): void {
		this.#tools.clear()
	}

	async #run(call: ToolCall): Promise<ToolResult> {
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
			const caller = call.caller
			const value = await (caller === undefined
				? tool.execute(call.arguments)
				: tool.execute(call.arguments, caller))
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

	#definition(tool: ToolInterface): ToolDefinition {
		const definition: {
			name: string
			description?: string
			parameters?: Readonly<Record<string, unknown>>
		} = {
			name: tool.name,
		}
		const description = tool.summary ?? tool.description
		if (description !== undefined) definition.description = description
		if (tool.parameters !== undefined) definition.parameters = tool.parameters
		return definition
	}
}
