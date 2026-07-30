import { isToolCall } from '@src/core'
import { describe, expect, it } from 'vitest'

describe('isToolCall', () => {
	it('accepts complete calls with empty or populated argument records', () => {
		expect(isToolCall({ id: '1', name: 'search', arguments: {} })).toBe(true)
		expect(isToolCall({ id: '2', name: 'search', arguments: { query: 'birds' } })).toBe(true)
	})

	it('rejects non-record values and incomplete calls', () => {
		for (const value of [
			null,
			undefined,
			'call',
			42,
			[],
			{ name: 'search', arguments: {} },
			{ id: '1', arguments: {} },
			{ id: 1, name: 'search', arguments: {} },
			{ id: '1', name: 1, arguments: {} },
			{ id: '1', name: 'search' },
		]) {
			expect(isToolCall(value)).toBe(false)
		}
	})

	it('rejects non-record arguments', () => {
		for (const args of [null, undefined, 'query=birds', 42, true, ['query']]) {
			expect(isToolCall({ id: '1', name: 'search', arguments: args })).toBe(false)
		}
	})
})
