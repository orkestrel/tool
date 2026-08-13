import type { ToolCall } from '@src/core'

// The fleet-wide helpers live in `@orkestrel/test`. What remains here is what is specific to this
// package: the tool call fixture and the browser-path predicate.

/**
 * Create a tool call for runtime tests.
 *
 * @param name - The tool name
 * @param args - The model-supplied arguments record
 * @param id - The correlation identifier
 * @returns A complete tool call
 */
export function createToolCall(
	name: string,
	args: Record<string, unknown> = {},
	id = 'call',
): ToolCall {
	return { id, name, arguments: args }
}

/**
 * Determine whether a repository-relative Vue path belongs to a browser application.
 *
 * @param path - The repository-relative path
 * @returns Whether the path is under the browser application
 */
export function isBrowserVuePath(path: string): boolean {
	return path.replaceAll('\\', '/').startsWith('app/browser/')
}
