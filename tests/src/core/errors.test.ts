import { ToolError, isToolError } from '@src/core'
import * as errors from '../../../src/core/errors.js'
import { describe, expect, it } from 'vitest'

describe('isToolError', () => {
	it('accepts a callable context that carries the declared faults', () => {
		const context = Object.assign(() => undefined, { faults: [] })
		expect(isToolError(new ToolError('ARGUMENTS', 'failure', context))).toBe(true)
	})

	it('refuses an invalid indexed fault hidden by a replaced iterator', () => {
		const faults = [42]
		Object.defineProperty(faults, Symbol.iterator, {
			value: Array.prototype[Symbol.iterator].bind([]),
		})
		const error = Object.assign(new RangeError('invalid fault report'), {
			code: 'ARGUMENTS',
			context: { faults },
		})
		Object.defineProperty(error, Symbol.for('@orkestrel/tool.ToolError'), { value: error })

		expect(isToolError(error)).toBe(false)
	})

	it('recognizes tool errors and rejects unrelated values', () => {
		const context = { faults: [] }
		const error = new ToolError('ARGUMENTS', 'invalid arguments', context)

		expect(errors).toHaveProperty('isToolError', isToolError)
		expect(isToolError(error)).toBe(true)
		expect(error.name).toBe('ToolError')
		expect(error.code).toBe('ARGUMENTS')
		expect(error.message).toBe('invalid arguments')
		expect(error.context).toBe(context)
		expect(new ToolError('SCHEMA', 'conflict').context).toBeUndefined()
		expect(isToolError(new Error('unrelated'))).toBe(false)
		expect(isToolError({ code: 'SCHEMA', message: 'conflict' })).toBe(false)
		expect(isToolError(undefined)).toBe(false)
		expect(isToolError(null)).toBe(false)
	})

	it('contains hostile prototype access while narrowing errors', () => {
		const hostile = new Proxy(
			{},
			{
				getPrototypeOf: () => {
					throw new Error('blocked prototype')
				},
			},
		)
		const revoked = Proxy.revocable({}, {})
		revoked.revoke()

		expect(isToolError(hostile)).toBe(false)
		expect(isToolError(revoked.proxy)).toBe(false)
	})
})
