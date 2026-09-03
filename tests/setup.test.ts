import { describe, expect, it } from 'vitest'
import { createToolCall } from './setup.js'

describe('createToolCall', () => {
	it('defaults the arguments record to empty and the id to call', () => {
		const call = createToolCall('echo')

		expect(call).toEqual({ id: 'call', name: 'echo', arguments: {} })
	})

	it('carries the supplied arguments and correlation id through unchanged', () => {
		const args = { value: 'hello' }

		const call = createToolCall('echo', args, 'turn-1')

		expect(call).toEqual({ id: 'turn-1', name: 'echo', arguments: args })
	})
})
