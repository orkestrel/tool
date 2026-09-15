import type { ToolErrorCode, ToolErrorContext } from './types.js'
import { isInstance } from '@orkestrel/contract'

/**
 * Reports a schema conflict or argument validation failure with a machine-readable code.
 *
 * @example
 * ```ts
 * import { ToolError } from '@orkestrel/tool'
 *
 * const error = new ToolError('SCHEMA', 'Choose contract or parameters')
 * error.code // 'SCHEMA'
 * ```
 */
export class ToolError extends Error {
	override readonly name = 'ToolError' as const
	readonly code: ToolErrorCode
	readonly context?: ToolErrorContext

	constructor(code: ToolErrorCode, message: string, context?: ToolErrorContext) {
		super(message)
		this.code = code
		if (context !== undefined) this.context = context
	}
}

/**
 * Checks whether a value is a tool error, containing hostile prototype access.
 *
 * @param value - The value to test
 * @returns True if the value is an instance of the tool error class; false otherwise
 *
 * @example
 * ```ts
 * import { ToolError, isToolError } from '@orkestrel/tool'
 *
 * isToolError(new ToolError('ARGUMENTS', 'Invalid amount')) // true
 * isToolError(new Error('Unrelated')) // false
 * ```
 */
export function isToolError(value: unknown): value is ToolError {
	return isInstance(value, ToolError)
}
