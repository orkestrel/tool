import type { ToolCall } from './types.js'
import { holds, isRecord, isString } from '@orkestrel/contract'

/**
 * Determines whether an unknown value is structurally a {@link ToolCall}, staying total
 * for malformed and adversarial input.
 *
 * @remarks
 * The accepted shape is a plain record with string `id` and `name` fields and a
 * plain-record `arguments` field. Optional caller context remains opaque and is not
 * read or verified.
 *
 * @param value - The value to test
 * @returns True if the value has the complete tool-call shape; false otherwise
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
