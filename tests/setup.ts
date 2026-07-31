import type { ToolCall } from '@src/core'

/**
 * Require a possibly absent value in a test assertion.
 *
 * @typeParam T - The expected value type
 * @param value - The value to require
 * @returns The present value
 * @throws {Error} When the value is `undefined`
 */
export function requireValue<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('expected value')
	return value
}

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
 * Resolve after a short real delay.
 *
 * @param ms - The delay in milliseconds
 * @returns A promise that resolves after the delay
 */
export function waitForDelay(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
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
