import type { ToolCall } from './types.js'
import { holds, isRecord, isString } from '@orkestrel/contract'

/**
 * Determine whether an unknown value is structurally a {@link ToolCall}.
 *
 * @remarks
 * This total guard accepts a plain record with string `id` and `name` fields and a
 * plain-record `arguments` field. Adversarial values return `false`.
 *
 * @param value - The value to test
 * @returns `true` when the value has the complete tool-call shape
 *
 * @example
 * ```ts
 * import { isToolCall } from '@orkestrel/tool'
 *
 * isToolCall({ id: '1', name: 'search', arguments: { query: 'birds' } }) // true
 * isToolCall({ id: '1', name: 'search', arguments: [] }) // false
 * ```
 */
export function isToolCall(value: unknown): value is ToolCall {
	return holds(
		() =>
			isRecord(value) && isString(value.id) && isString(value.name) && isRecord(value.arguments),
	)
}
