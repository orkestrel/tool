import type { ToolErrorCode, ToolErrorContext } from './types.js'
import { arrayOf, holds, INTRINSICS, isObject, isString } from '@orkestrel/contract'

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
		INTRINSICS.define(this, Symbol.for('@orkestrel/tool.ToolError'), { value: this })
		this.code = code
		if (context !== undefined) this.context = context
	}
}

/**
 * Checks whether a value is a tool error, containing hostile prototype access.
 *
 * @remarks
 * Recognizes self-branded errors across package copies and subclasses and refuses
 * transparent proxies. Validates the declared code and optional fault report.
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
	return holds(() => {
		if (!(value instanceof Error) || INTRINSICS.prototype(value) === Error.prototype) return false
		const brand = INTRINSICS.describe(value, Symbol.for('@orkestrel/tool.ToolError'))
		if (brand?.value !== value) return false
		const code: unknown = INTRINSICS.reflect.read(value, 'code')
		if (code !== 'SCHEMA' && code !== 'ARGUMENTS') return false
		const context: unknown = INTRINSICS.reflect.read(value, 'context')
		if (context === undefined) return true
		if (!isObject(context)) return false
		const faults: unknown = INTRINSICS.reflect.read(context, 'faults')
		if (faults === undefined) return true
		if (!INTRINSICS.array(faults)) return false
		return Array.from(faults).every((fault: unknown) => {
			if (!isObject(fault)) return false
			const path: unknown = INTRINSICS.reflect.read(fault, 'path')
			if (!isString(path) && !arrayOf(isString)(path)) return false
			const reason: unknown = INTRINSICS.reflect.read(fault, 'reason')
			if (reason === 'variant') {
				return typeof INTRINSICS.reflect.read(fault, 'variants') === 'number'
			}
			if (reason === 'oneOf') {
				return typeof INTRINSICS.reflect.read(fault, 'matched') === 'number'
			}
			const expected: unknown = INTRINSICS.reflect.read(fault, 'expected')
			if (
				![
					'string',
					'number',
					'integer',
					'boolean',
					'null',
					'literal',
					'array',
					'object',
					'union',
					'json',
				].some((candidate) => candidate === expected)
			)
				return false
			if (reason === 'missing') return true
			if (!isString(INTRINSICS.reflect.read(fault, 'received'))) return false
			if (reason === 'type') return true
			if (reason !== 'constraint') return false
			const constraint: unknown = INTRINSICS.reflect.read(fault, 'constraint')
			const limit: unknown = INTRINSICS.reflect.read(fault, 'limit')
			return (
				(constraint === 'min' ||
					constraint === 'max' ||
					constraint === 'pattern' ||
					constraint === 'integer') &&
				(limit === undefined || typeof limit === 'number' || typeof limit === 'string')
			)
		})
	})
}
