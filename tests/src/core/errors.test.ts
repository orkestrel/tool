import { ToolError, isToolError } from '@src/core'
import { FAULT_CONSTRAINTS, FAULT_KINDS, isAuditFault } from '@orkestrel/contract'
import * as errors from '../../../src/core/errors.js'
import { describe, expect, it } from 'vitest'

describe('isToolError', () => {
	it('accepts a callable context that carries the declared faults', () => {
		const context = Object.assign(() => undefined, { faults: [] })
		expect(isToolError(new ToolError('ARGUMENTS', 'failure', context))).toBe(true)
	})

	it('accepts an audit report carrying an extra fault', () => {
		const context = { faults: [{ reason: 'extra' as const, path: ['extra'] }] }

		expect(isToolError(new ToolError('ARGUMENTS', 'failure', context))).toBe(true)
	})

	// The fault vocabulary is contract's, so every kind and constraint contract declares is admitted.
	it('accepts each fault kind and constraint the installed contract declares', () => {
		const faults = [
			...FAULT_KINDS.map((expected) => ({
				reason: 'type' as const,
				path: ['args'],
				expected,
				received: '"x"',
			})),
			...FAULT_CONSTRAINTS.map((constraint) => ({
				reason: 'constraint' as const,
				path: ['args'],
				expected: 'string' as const,
				constraint,
				received: '"x"',
			})),
		]

		expect(isToolError(new ToolError('ARGUMENTS', 'failure', { faults }))).toBe(true)
		expect(faults.every((fault) => isAuditFault(fault))).toBe(true)
	})

	it('refuses a fault carrying a key contract does not declare for its reason', () => {
		const error = new ToolError('ARGUMENTS', 'failure')
		Object.defineProperty(error, 'context', {
			value: { faults: [{ reason: 'missing', path: ['args'], expected: 'string', stray: true }] },
		})

		expect(isToolError(error)).toBe(false)
	})

	it('refuses an extra fault whose path is not a path', () => {
		const error = new ToolError('ARGUMENTS', 'failure')
		Object.defineProperty(error, 'context', { value: { faults: [{ reason: 'extra', path: 5 }] } })

		expect(isToolError(error)).toBe(false)
	})

	it('carries a cause through the error options and omits it otherwise', () => {
		const cause = new Error('unreadable schema')

		expect(new ToolError('SCHEMA', 'failure', undefined, { cause }).cause).toBe(cause)
		expect(new ToolError('SCHEMA', 'failure')).not.toHaveProperty('cause')
		expect(isToolError(new ToolError('SCHEMA', 'failure', undefined, { cause }))).toBe(true)
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
