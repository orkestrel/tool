import type { Fault } from '@orkestrel/contract'
import type { ToolCall, ToolContext, ToolErrorContext, ToolInterface, ToolOptions } from '@src/core'
import {
	attempt,
	createContract,
	numberShape,
	objectShape,
	schemaToParameters,
	stringShape,
	unionShape,
	oneOfShape,
} from '@orkestrel/contract'
import { createRecorder } from '@orkestrel/test'
import { Tool, ToolError, isToolError } from '@src/core'
import { describe, expect, expectTypeOf, it } from 'vitest'

describe('Tool', () => {
	const context: ToolContext = { signal: new AbortController().signal }

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

		expect(sync.execute({ a: 2, b: 3 }, context)).toBe(5)
		await expect(async.execute({ text: 'hi' }, context)).resolves.toBe('hi')
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

		tool.execute(args, context)

		expect(received).toHaveLength(1)
		expect(received[0]).toBe(args)
	})

	it('requires execution context and excludes caller from the call envelope', () => {
		expectTypeOf<ToolInterface['execute']>().parameters.toEqualTypeOf<
			[args: Readonly<Record<string, unknown>>, context: ToolContext]
		>()
		expectTypeOf<ToolOptions['execute']>().parameters.toEqualTypeOf<
			[args: Readonly<Record<string, unknown>>, context: ToolContext]
		>()
		expectTypeOf<keyof ToolCall>().toEqualTypeOf<'id' | 'name' | 'arguments'>()
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const tool = new Tool({ name: 'capture', execute: recorder.handler })
		tool.execute({}, context)
		expect(recorder.count).toBe(1)
		expect(recorder.calls[0]?.[1]).toBe(context)
	})

	it('delivers context to an unknown-annotated parameter and caller through context', () => {
		const recorder = createRecorder<[unknown]>()
		const tool = new Tool({
			name: 'legacy',
			execute: (_args, caller: unknown) => recorder.handler(caller),
		})
		const migrated = new Tool({ name: 'migrated', execute: (_args, execution) => execution.caller })
		const identified: ToolContext = { signal: context.signal, caller: { subject: 'reader' } }

		tool.execute({}, identified)

		expect(recorder.calls[0]?.[0]).toBe(identified)
		expect(recorder.calls[0]?.[0]).not.toBe(identified.caller)
		expect(migrated.execute({}, identified)).toBe(identified.caller)
	})

	it('enters a direct handler with an already-aborted signal', () => {
		const controller = new AbortController()
		controller.abort('direct abort')
		const recorder = createRecorder<[ToolContext]>()
		const tool = new Tool({
			name: 'direct',
			execute: (_args, execution) => {
				recorder.handler(execution)
				return execution.signal.aborted
			},
		})
		const aborted: ToolContext = { signal: controller.signal }

		expect(tool.execute({}, aborted)).toBe(true)
		expect(recorder.count).toBe(1)
		expect(recorder.calls[0]?.[0]).toBe(aborted)
	})

	it('forwards the exact context and always supplies the handler context argument', () => {
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const tool = new Tool({ name: 'capture', execute: recorder.handler })
		const args = {}
		const identified: ToolContext = { signal: context.signal, caller: { subject: 'reader' } }

		tool.execute(args, context)
		tool.execute(args, identified)

		expect(recorder.calls).toEqual([
			[args, context],
			[args, identified],
		])
		expect(recorder.calls[0]?.[1]).toBe(context)
		expect(recorder.calls[1]?.[1]).toBe(identified)
	})

	it('derives advertised parameters from the supplied contract at construction', () => {
		const shape = objectShape({ amount: numberShape() })
		const expected = schemaToParameters(createContract(shape).schema)
		const tool = new Tool({ name: 'amount', contract: shape, execute: (args) => args.amount })

		expect(expected).toBeDefined()
		expect(expected?.type).toBe('object')
		expect(tool.parameters).toEqual(expected)
		const parameters = tool.parameters
		expect(tool.parameters).toBe(parameters)
		expect(tool.execute({ amount: 3 }, context)).toBe(3)
		expect(tool.parameters).toBe(parameters)
	})

	it('rejects simultaneous contract and parameters with a guarded SCHEMA error', () => {
		const result = attempt(
			() =>
				new Tool({
					name: 'conflict',
					contract: objectShape({}),
					parameters: {},
					execute: () => 0,
				}),
		)

		expect(result.success).toBe(false)
		if (result.success) throw new Error('Expected a schema conflict')
		expect(isToolError(result.error)).toBe(true)
		if (!isToolError(result.error)) throw new Error('Expected a tool error')
		expect(result.error).toBeInstanceOf(Error)
		expect(result.error.code).toBe('SCHEMA')
	})

	it('refuses invalid arguments before the handler and preserves the full fault report', () => {
		const shape = objectShape({
			profile: objectShape({ age: numberShape(), name: stringShape({ min: 1 }) }),
		})
		const args = { profile: { age: 'invalid', name: '' } }
		const faults = createContract(shape).explain(args)
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const tool = new Tool({ name: 'profile', contract: shape, execute: recorder.handler })

		const result = attempt(() => tool.execute(args, context))

		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected an argument error')
		expect(result.error).toBeInstanceOf(ToolError)
		expect(result.error.code).toBe('ARGUMENTS')
		expect(result.error.message).toBe('profile.age: type; expected number; received "invalid"')
		expect(result.error.context).toEqual({ faults })
		expectTypeOf(result.error.context).toEqualTypeOf<ToolErrorContext | undefined>()
		expectTypeOf(result.error.context?.faults).toEqualTypeOf<readonly Fault[] | undefined>()
		expectTypeOf(result.error.name).toEqualTypeOf<'ToolError'>()
		expect(result.error.context?.faults?.[0]?.reason).toBe('type')
		expect(faults).toHaveLength(2)
		expect(recorder.count).toBe(0)
	})

	it('reports missing, constraint, variant, and oneOf faults without inventing absent members', () => {
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const missing = new Tool({
			name: 'missing',
			contract: objectShape({ amount: numberShape() }),
			execute: recorder.handler,
		})
		const constrained = new Tool({
			name: 'bounded',
			contract: objectShape({ amount: numberShape({ min: 1 }) }),
			execute: recorder.handler,
		})
		const variant = new Tool({
			name: 'variant',
			contract: objectShape({ amount: unionShape(numberShape(), stringShape({ min: 3 })) }),
			execute: recorder.handler,
		})
		const exclusive = new Tool({
			name: 'exclusive',
			contract: oneOfShape(objectShape({}), objectShape({})),
			execute: recorder.handler,
		})

		const absent = attempt(() => missing.execute({}, context))
		expect(absent.success).toBe(false)
		if (absent.success) throw new Error('Expected missing arguments')
		expect(isToolError(absent.error)).toBe(true)
		if (!isToolError(absent.error)) throw new Error('Expected a tool error')
		expect(absent.error.code).toBe('ARGUMENTS')
		expect(absent.error.message).toBe('amount: missing; expected number')
		expect(recorder.count).toBe(0)

		const bounded = attempt(() => constrained.execute({ amount: 0 }, context))
		expect(bounded.success).toBe(false)
		if (bounded.success) throw new Error('Expected a constraint fault')
		expect(isToolError(bounded.error)).toBe(true)
		if (!isToolError(bounded.error)) throw new Error('Expected a tool error')
		expect(bounded.error.code).toBe('ARGUMENTS')
		expect(bounded.error.message).toBe(
			'amount: constraint; expected number; received 0; constraint min; limit 1',
		)
		expect(recorder.count).toBe(0)

		const unmatched = attempt(() => variant.execute({ amount: {} }, context))
		expect(unmatched.success).toBe(false)
		if (unmatched.success) throw new Error('Expected a variant fault')
		expect(isToolError(unmatched.error)).toBe(true)
		if (!isToolError(unmatched.error)) throw new Error('Expected a tool error')
		expect(unmatched.error.code).toBe('ARGUMENTS')
		expect(unmatched.error.message).toBe('amount: variant; variants 2')
		expect(recorder.count).toBe(0)

		const overlapping = attempt(() => exclusive.execute({}, context))
		expect(overlapping.success).toBe(false)
		if (overlapping.success) throw new Error('Expected a oneOf fault')
		expect(isToolError(overlapping.error)).toBe(true)
		if (!isToolError(overlapping.error)) throw new Error('Expected a tool error')
		expect(overlapping.error.code).toBe('ARGUMENTS')
		expect(overlapping.error.message).toBe(': oneOf; matched 2')
		expect(recorder.count).toBe(0)
	})

	it('validates with explain and forwards parsed arguments with coercion and dropped keys', () => {
		const shape = objectShape({ amount: numberShape() })
		const contract = createContract(shape)
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const tool = new Tool({
			name: 'amount',
			contract: shape,
			execute: recorder.handler,
		})
		const args = { amount: '3', extra: 'undeclared' }
		const valid = { amount: 7 }

		expect(contract.explain(args)).toEqual([])
		tool.execute(args, context)
		expect(recorder.calls[0]?.[0]).toEqual({ amount: 3 })
		expect(recorder.calls[0]?.[0]).not.toHaveProperty('extra')
		expect(recorder.calls[0]?.[0]).not.toBe(args)
		expect(args).toEqual({ amount: '3', extra: 'undeclared' })
		expect(contract.explain(valid)).toEqual([])
		tool.execute(valid, context)
		expect(recorder.calls[1]?.[0]).toEqual(valid)
		expect(recorder.calls[1]?.[0]).not.toBe(valid)
		expect(recorder.calls[1]?.[1]).toBe(context)

		const invalid = { amount: 'invalid' }
		expect(contract.explain(invalid)).not.toEqual([])
		const refused = attempt(() => tool.execute(invalid, context))
		expect(refused.success).toBe(false)
		if (refused.success || !isToolError(refused.error))
			throw new Error('Expected an argument error')
		expect(refused.error.code).toBe('ARGUMENTS')
		expect(refused.error.message).toBe('amount: type; expected number; received "invalid"')
		expect(recorder.count).toBe(2)
	})

	it('refuses a parse that becomes undefined after a clean explanation', () => {
		const shape = objectShape({ amount: numberShape() })
		const contract = createContract(shape)
		const reads = createRecorder<[]>()
		const args: Readonly<Record<string, unknown>> = Object.defineProperty({}, 'amount', {
			enumerable: true,
			get: () => {
				reads.handler()
				return reads.count === 1 ? 3 : 'invalid'
			},
		})
		expect(contract.explain(args)).toEqual([])
		expect(contract.parse(args)).toBeUndefined()
		reads.clear()
		const entered = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const tool = new Tool({ name: 'unstable', contract: shape, execute: entered.handler })

		const result = attempt(() => tool.execute(args, context))

		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected a parse error')
		expect(result.error.code).toBe('ARGUMENTS')
		expect(result.error.message).toBe('Arguments did not parse')
		expect(result.error.context).toBeUndefined()
		expect(entered.count).toBe(0)
	})

	it('does not validate an advertised schema without a contract', () => {
		const tool = new Tool({
			name: 'amount',
			parameters: { type: 'object', properties: { amount: { type: 'number' } } },
			execute: (args) => args.amount,
		})

		expect(tool.execute({ amount: 'invalid' }, context)).toBe('invalid')
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
		expect(new Tool({ name: 'zero', execute: () => 0 }).execute({}, context)).toBe(0)
		expect(new Tool({ name: 'empty', execute: () => '' }).execute({}, context)).toBe('')
		expect(new Tool({ name: 'false', execute: () => false }).execute({}, context)).toBe(false)
		expect(new Tool({ name: 'null', execute: () => null }).execute({}, context)).toBeNull()
		expect(
			new Tool({ name: 'void', execute: () => undefined }).execute({}, context),
		).toBeUndefined()
	})

	it('does not catch a synchronous throw', () => {
		const tool = new Tool({
			name: 'boom',
			execute: () => {
				throw new Error('sync boom')
			},
		})

		expect(() => tool.execute({}, context)).toThrow('sync boom')
	})

	it('does not swallow an asynchronous rejection', async () => {
		const tool = new Tool({
			name: 'reject',
			execute: () => Promise.reject(new Error('async boom')),
		})

		await expect(tool.execute({}, context)).rejects.toThrow('async boom')
	})
})
