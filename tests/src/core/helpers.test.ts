import { isToolCall } from '@src/core'
import { describe, expect, it } from 'vitest'

describe('isToolCall', () => {
	it('accepts complete calls with empty or populated argument records', () => {
		expect(isToolCall({ id: '1', name: 'search', arguments: {} })).toBe(true)
		expect(isToolCall({ id: '2', name: 'search', arguments: { query: 'birds' } })).toBe(true)
	})

	it('accepts opaque caller context without reading it', () => {
		const call = { id: '1', name: 'search', arguments: {} }
		Object.defineProperty(call, 'caller', {
			get: () => {
				throw new Error('caller context is opaque')
			},
		})

		expect(() => isToolCall(call)).not.toThrow()
		expect(isToolCall(call)).toBe(true)
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

	it.each(['id', 'name', 'arguments'])('rejects a throwing %s getter without throwing', (field) => {
		const call = { id: '1', name: 'search', arguments: {} }
		Object.defineProperty(call, field, {
			get: () => {
				throw new Error(`blocked ${field}`)
			},
		})

		expect(() => isToolCall(call)).not.toThrow()
		expect(isToolCall(call)).toBe(false)
	})

	it('contains hostile Proxy access traps', () => {
		const call = { id: '1', name: 'search', arguments: {} }
		const throwingGet = new Proxy(call, {
			get: () => {
				throw new Error('blocked get')
			},
		})
		const throwingHas = new Proxy(call, {
			get: (target, property, receiver) => {
				Reflect.has(receiver, property)
				return Reflect.get(target, property, receiver)
			},
			has: () => {
				throw new Error('blocked has')
			},
		})

		expect(() => isToolCall(throwingGet)).not.toThrow()
		expect(isToolCall(throwingGet)).toBe(false)
		expect(() => isToolCall(throwingHas)).not.toThrow()
		expect(isToolCall(throwingHas)).toBe(false)
	})

	it('accepts a complete null-prototype call and arguments record', () => {
		const args: unknown = Object.create(null)
		const call: unknown = Object.assign(Object.create(null), {
			id: '1',
			name: 'search',
			arguments: args,
		})

		expect(isToolCall(call)).toBe(true)
	})
})
