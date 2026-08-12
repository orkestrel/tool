import { Tool } from '@src/core'
import { describe, expect, it } from 'vitest'

describe('Tool', () => {
	it('runs synchronous and asynchronous handlers', async () => {
		const sync = new Tool({
			name: 'add',
			execute: (args) => Number(args.a) + Number(args.b),
		})
		const async = new Tool({
			name: 'echo',
			execute: async (args) => {
				await Promise.resolve()
				return args.text
			},
		})

		expect(sync.execute({ a: 2, b: 3 })).toBe(5)
		await expect(async.execute({ text: 'hi' })).resolves.toBe('hi')
	})

	it('forwards the exact arguments object', () => {
		const received: Array<Readonly<Record<string, unknown>>> = []
		const tool = new Tool({
			name: 'capture',
			execute: (args) => {
				received.push(args)
				return undefined
			},
		})
		const args = { x: 1, nested: { y: 2 }, list: [1, 2, 3] }

		tool.execute(args)

		expect(received).toHaveLength(1)
		expect(received[0]).toBe(args)
	})

	it('forwards caller context while preserving absent call arity', () => {
		const received: unknown[][] = []
		const tool = new Tool({
			name: 'capture',
			execute: (...values) => {
				received.push(values)
				return undefined
			},
		})
		const args = {}
		const caller = { subject: 'user-42' }

		tool.execute(args)
		tool.execute(args, caller)

		expect(received).toHaveLength(2)
		expect(received[0]).toHaveLength(1)
		expect(received[0]?.[0]).toBe(args)
		expect(received[0]?.[1]).toBeUndefined()
		expect(received[1]).toHaveLength(2)
		expect(received[1]?.[0]).toBe(args)
		expect(received[1]?.[1]).toBe(caller)
	})

	it('exposes every definition field independently and by reference', () => {
		const parameters = { type: 'object', properties: { a: { type: 'number' } } }
		const complete = new Tool({
			name: 'add',
			description: 'Add two numbers',
			summary: 'Add numbers.',
			parameters,
			execute: () => 0,
		})
		const description = new Tool({
			name: 'description',
			description: 'Only a description',
			execute: () => 0,
		})
		const schema = new Tool({ name: 'schema', parameters, execute: () => 0 })
		const bare = new Tool({ name: 'bare', execute: () => undefined })

		expect(complete.name).toBe('add')
		expect(complete.description).toBe('Add two numbers')
		expect(complete.summary).toBe('Add numbers.')
		expect(complete.parameters).toBe(parameters)
		expect(description.parameters).toBeUndefined()
		expect(schema.description).toBeUndefined()
		expect(schema.parameters).toBe(parameters)
		expect(bare.description).toBeUndefined()
		expect(bare.summary).toBeUndefined()
		expect(bare.parameters).toBeUndefined()
	})

	it('passes falsy, null, and undefined values through verbatim', () => {
		expect(new Tool({ name: 'zero', execute: () => 0 }).execute({})).toBe(0)
		expect(new Tool({ name: 'empty', execute: () => '' }).execute({})).toBe('')
		expect(new Tool({ name: 'false', execute: () => false }).execute({})).toBe(false)
		expect(new Tool({ name: 'null', execute: () => null }).execute({})).toBeNull()
		expect(new Tool({ name: 'void', execute: () => undefined }).execute({})).toBeUndefined()
	})

	it('does not catch a synchronous throw', () => {
		const tool = new Tool({
			name: 'boom',
			execute: () => {
				throw new Error('sync boom')
			},
		})

		expect(() => tool.execute({})).toThrow('sync boom')
	})

	it('does not swallow an asynchronous rejection', async () => {
		const tool = new Tool({
			name: 'reject',
			execute: () => Promise.reject(new Error('async boom')),
		})

		await expect(tool.execute({})).rejects.toThrow('async boom')
	})
})
