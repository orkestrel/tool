import { describe, expect, it } from 'vitest'
import { createToolCall, isBrowserVuePath } from './setup.js'

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

describe('isBrowserVuePath', () => {
	it('accepts a repository-relative path under app/browser/ under either separator family', () => {
		const forward = 'app/browser/components/Panel.vue'
		const backslash = 'app\\browser\\components\\Panel.vue'

		// Second route: split each path on both separators and compare the leading segments
		// directly, instead of reusing the module's own replace-then-startsWith logic.
		const expectedFromForward = forward.split(/[\\/]/).slice(0, 2).join('/') === 'app/browser'
		const expectedFromBackslash = backslash.split(/[\\/]/).slice(0, 2).join('/') === 'app/browser'

		expect(isBrowserVuePath(forward)).toBe(expectedFromForward)
		expect(isBrowserVuePath(backslash)).toBe(expectedFromBackslash)
		expect(isBrowserVuePath(forward)).toBe(true)
		expect(isBrowserVuePath(backslash)).toBe(true)
	})

	it('refuses a sibling application path and a prefix lookalike', () => {
		const sibling = 'app/server/components/Panel.vue'
		const lookalike = 'app/browserish/Panel.vue'

		expect(isBrowserVuePath(sibling)).toBe(false)
		expect(isBrowserVuePath(lookalike)).toBe(false)
	})
})
