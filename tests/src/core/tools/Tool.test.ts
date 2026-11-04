import type { AuditFault } from '@orkestrel/contract'
import type { ToolCall, ToolContext, ToolErrorContext, ToolInterface, ToolOptions } from '@src/core'
import {
	FAULT_LIMIT,
	attempt,
	booleanShape,
	createContract,
	isContractError,
	numberShape,
	objectShape,
	optionalShape,
	schemaToParameters,
	stringShape,
	unionShape,
	oneOfShape,
} from '@orkestrel/contract'
import { createRecorder } from '@orkestrel/test'
import {
	CLOSED_PARAMETERS,
	OPEN_PARAMETERS,
	REFUSAL_TEXT_LIMIT,
	Tool,
	ToolError,
	isToolError,
} from '@src/core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
	NON_RECORD_PARAMETERS,
	OPEN_ARGUMENTS,
	PET_PARAMETERS,
	SCHEMA_DEFAULT_CALLS,
	SCHEMA_VALID_CALLS,
	createChainArguments,
	createChainSchema,
	createUnreadableSchema,
} from '../../../setup.js'

describe('Tool', () => {
	const context: ToolContext = { signal: new AbortController().signal }

	it('runs synchronous and asynchronous handlers', async () => {
		const sync = new Tool({
			name: 'add',
			contract: OPEN_ARGUMENTS,
			execute: (args) => Number(args.a) + Number(args.b),
		})
		const async = new Tool({
			name: 'echo',
			contract: OPEN_ARGUMENTS,
			execute: async (args) => {
				await Promise.resolve()
				return args.text
			},
		})

		expect(sync.execute({ a: 2, b: 3 }, context)).toBe(5)
		await expect(async.execute({ text: 'hi' }, context)).resolves.toBe('hi')
	})

	it('forwards the exact arguments object when strict is false', () => {
		const received: Array<Readonly<Record<string, unknown>>> = []
		const tool = new Tool({
			name: 'capture',
			strict: false,
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
		expect(result.error.message).toBe(
			[
				'profile.age: type; expected number; received "invalid"',
				'profile.name: constraint; expected string; received ""; constraint min; limit 1',
			].join('\n'),
		)
		expect(result.error.context).toEqual({ faults })
		expectTypeOf(result.error.context).toEqualTypeOf<ToolErrorContext | undefined>()
		expectTypeOf(result.error.context?.faults).toEqualTypeOf<readonly AuditFault[] | undefined>()
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
		expect(unmatched.error.message).toBe(
			'amount: variant; the value matches none of the 2 declared forms; send it exactly as the schema declares, one of: number or string (minLength 3)',
		)
		expect(unmatched.error.context?.faults).toEqual([
			{ reason: 'variant', path: ['amount'], variants: 2 },
		])
		expect(recorder.count).toBe(0)

		const overlapping = attempt(() => exclusive.execute({}, context))
		expect(overlapping.success).toBe(false)
		if (overlapping.success) throw new Error('Expected a oneOf fault')
		expect(isToolError(overlapping.error)).toBe(true)
		if (!isToolError(overlapping.error)) throw new Error('Expected a tool error')
		expect(overlapping.error.code).toBe('ARGUMENTS')
		expect(overlapping.error.message).toMatch(
			/^: oneOf; the value matches 2 of the 2 declared forms and must match exactly one; send it exactly as the schema declares/u,
		)
		expect(recorder.count).toBe(0)
	})

	it('refuses an undeclared key a clean explanation would drop', () => {
		const shape = objectShape({ amount: numberShape() })
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const tool = new Tool({ name: 'amount', contract: shape, execute: recorder.handler })
		const args = { amount: 3, extra: 1 }

		expect(createContract(shape).explain(args)).toEqual([])
		const result = attempt(() => tool.execute(args, context))

		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected an argument error')
		expect(result.error.code).toBe('ARGUMENTS')
		expect(result.error.context?.faults).toEqual([{ reason: 'extra', path: ['extra'] }])
		expect(result.error.message).toBe(
			'extra: extra; this key is not declared, remove it or use a declared key: amount',
		)
		expect(recorder.count).toBe(0)
	})

	it('refuses a misspelt optional key rather than running with its default', () => {
		const tool = new Tool({
			name: 'search',
			contract: objectShape({ limit: optionalShape(numberShape({ min: 1 })) }),
			execute: () => 'ran',
		})

		const result = attempt(() => tool.execute({ limti: 5 }, context))

		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected an argument error')
		expect(result.error.context?.faults).toEqual([{ reason: 'extra', path: ['limti'] }])
	})

	it('reports every fault in one refusal, undeclared keys beside parse faults', () => {
		const tool = new Tool({
			name: 'amount',
			contract: objectShape({ amount: numberShape(), label: stringShape() }),
			execute: () => 'ran',
		})

		const result = attempt(() => tool.execute({ amount: 'invalid', extra: 1 }, context))

		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected an argument error')
		expect(result.error.message.split('\n')).toEqual([
			'amount: type; expected number; received "invalid"',
			'label: missing; expected string',
			'extra: extra; this key is not declared, remove it or use a declared key: amount, label',
		])
		expect(result.error.context?.faults).toHaveLength(3)
	})

	it('admits an undeclared key under an open shape and hands it on', () => {
		const tool = new Tool({
			name: 'open',
			contract: objectShape({ a: stringShape() }, { additionalProperties: true }),
			execute: (args) => args,
		})

		expect(tool.execute({ a: 'x', z: 1 }, context)).toEqual({ a: 'x', z: 1 })
	})

	it('refuses a full audit whose cap could hide an undeclared key', () => {
		const keys = Array.from({ length: FAULT_LIMIT + 6 }, (_, index) => `key${String(index)}`)
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const tool = new Tool({
			name: 'wide',
			contract: objectShape(Object.fromEntries(keys.map((key) => [key, numberShape()]))),
			execute: recorder.handler,
		})
		const args = { ...Object.fromEntries(keys.map((key) => [key, '1'])), unknown: 1 }

		const result = attempt(() => tool.execute(args, context))

		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected an argument error')
		expect(result.error.code).toBe('ARGUMENTS')
		expect(result.error.context?.faults).toHaveLength(FAULT_LIMIT)
		expect(result.error.message.length).toBeLessThanOrEqual(REFUSAL_TEXT_LIMIT)
		expect(result.error.message.split('\n').at(-1)).toMatch(
			new RegExp(
				`^and \\d+ more faults, the report stops at ${String(FAULT_LIMIT)}; correct these and call again$`,
				'u',
			),
		)
		expect(recorder.count).toBe(0)
	})

	it('refuses to repair through a union, which parses by declaration order', () => {
		const shape = objectShape({
			choice: unionShape(
				objectShape({ amount: numberShape() }),
				objectShape({ name: stringShape() }),
			),
		})
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const tool = new Tool({ name: 'choice', contract: shape, execute: recorder.handler })
		const args = { choice: { amount: '500' } }

		expect(createContract(shape).explain(args)).toEqual([])
		const result = attempt(() => tool.execute(args, context))

		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected an argument error')
		expect(result.error.message).toBe(
			'choice: variant; the value matches none of the 2 declared forms; send it exactly as the schema declares, one of: {"amount": number} or {"name": string}',
		)
		expect(recorder.count).toBe(0)
	})

	it('names enough of a union that the refusal alone gives a correct second call', () => {
		const tool = new Tool({
			name: 'where',
			contract: objectShape({
				choice: unionShape(
					objectShape({ city: stringShape() }),
					objectShape({ zip: numberShape() }),
				),
			}),
			execute: (args) => args,
		})

		const refused = attempt(() => tool.execute({ choice: { zip: '123' } }, context))

		expect(refused.success).toBe(false)
		if (refused.success || !isToolError(refused.error))
			throw new Error('Expected an argument error')
		expect(refused.error.message).toBe(
			'choice: variant; the value matches none of the 2 declared forms; send it exactly as the schema declares, one of: {"city": string} or {"zip": number}',
		)
		expect(refused.error.context?.faults).toEqual([
			{ reason: 'variant', path: ['choice'], variants: 2 },
		])
		expect(tool.execute({ choice: { zip: 123 } }, context)).toEqual({ choice: { zip: 123 } })
	})

	it('tells the author of a tool that declares nothing what to supply', () => {
		const tool = new Tool({ name: 'echo', execute: (args) => args.text })

		const refused = attempt(() => tool.execute({ text: 'hello' }, context))

		expect(refused.success).toBe(false)
		if (refused.success || !isToolError(refused.error))
			throw new Error('Expected an argument error')
		expect(refused.error.message).toBe(
			"text: extra; this tool declares no arguments, so remove this key; to accept it, the tool's author must supply contract or parameters, or strict: false",
		)
		expect(refused.error.context?.faults).toEqual([{ reason: 'extra', path: ['text'] }])
		expect(
			new Tool({ name: 'echo', strict: false, execute: (args) => args.text }).execute(
				{ text: 'hello' },
				context,
			),
		).toBe('hello')
		expect(
			new Tool({
				name: 'echo',
				contract: objectShape({ text: stringShape() }),
				execute: (args) => args.text,
			}).execute({ text: 'hello' }, context),
		).toBe('hello')
	})

	it('never tells a caller to remove a key another arm declares', () => {
		const tool = new Tool({ name: 'pets', parameters: PET_PARAMETERS, execute: () => 'ran' })

		const result = attempt(() => tool.execute({ pet: { kind: 'b', y: '5' } }, context))

		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected an argument error')
		expect(result.error.context?.faults).toEqual([
			{ reason: 'variant', path: ['pet'], variants: 2 },
		])
		expect(result.error.message.startsWith('pet: variant; ')).toBe(true)
		expect(result.error.message).not.toContain('remove it')
	})

	it('keeps a refusal near 2 KB at 200 long keys, and carries every fault to its limit', () => {
		const tool = new Tool({ name: 'bare', execute: () => 'ran' })
		const args = Object.fromEntries(
			Array.from({ length: 200 }, (_, index) => [`${'k'.repeat(5000)}${String(index)}`, 1]),
		)

		const result = attempt(() => tool.execute(args, context))

		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected an argument error')
		expect(result.error.message.length).toBeLessThanOrEqual(REFUSAL_TEXT_LIMIT)
		expect(result.error.context?.faults).toHaveLength(FAULT_LIMIT)
		expect(result.error.message.split('\n').at(-1)).toMatch(/^and \d+ more faults/u)
	})

	it('keeps a refusal near 2 KB at depth, with long keys under a long path', () => {
		const keys = Array.from({ length: 80 }, (_, index) => `${'t'.repeat(5000)}${String(index)}`)
		const tool = new Tool({
			name: 'deep',
			parameters: createChainSchema(30),
			execute: () => 'ran',
		})

		const result = attempt(() => tool.execute(createChainArguments(20, keys), context))

		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected an argument error')
		expect(result.error.message.length).toBeLessThanOrEqual(REFUSAL_TEXT_LIMIT)
		expect(result.error.message.split('\n')[0]).toContain('child.….')
		expect(result.error.context?.faults).toHaveLength(FAULT_LIMIT)
	})

	it('hands the published leaf repairs to the handler', () => {
		const tool = new Tool({
			name: 'leaves',
			contract: objectShape({ count: numberShape(), flag: booleanShape(), label: stringShape() }),
			execute: (args) => args,
		})

		expect(tool.execute({ count: '30.0', flag: 'true', label: 5 }, context)).toEqual({
			count: 30,
			flag: true,
			label: '5',
		})
	})

	it('repairs a coercible value through a nullable, as Pydantic declares an optional field', () => {
		const tool = new Tool({
			name: 'search',
			parameters: {
				type: 'object',
				title: 'searchArguments',
				properties: {
					limit: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null, title: 'Limit' },
				},
			},
			execute: (args) => args,
		})

		expect(tool.execute({ limit: '5' }, context)).toEqual({ limit: 5 })
		expect(tool.execute({ limit: 5 }, context)).toEqual({ limit: 5 })
		expect(tool.execute({ limit: null }, context)).toEqual({ limit: null })
		expect(tool.execute({}, context)).toEqual({})

		const refused = attempt(() => tool.execute({ limit: 'many' }, context))
		expect(refused.success).toBe(false)
		if (refused.success || !isToolError(refused.error))
			throw new Error('Expected an argument error')
		expect(refused.error.message).toBe('limit: type; expected integer; received "many"')
	})

	it('repairs the same way through a nullable spelled as a type list', () => {
		const tool = new Tool({
			name: 'search',
			parameters: { type: 'object', properties: { limit: { type: ['integer', 'null'] } } },
			execute: (args) => args,
		})

		expect(tool.execute({ limit: '5' }, context)).toEqual({ limit: 5 })
		expect(tool.execute({ limit: null }, context)).toEqual({ limit: null })

		const refused = attempt(() => tool.execute({ limit: 'many' }, context))
		expect(refused.success).toBe(false)
		if (refused.success || !isToolError(refused.error))
			throw new Error('Expected an argument error')
		expect(refused.error.message).toBe('limit: type; expected integer; received "many"')
	})

	it('reports the inner fault of a nullable closed object, with its declared keys', () => {
		const tool = new Tool({
			name: 'search',
			parameters: {
				type: 'object',
				properties: {
					page: {
						anyOf: [
							{
								type: 'object',
								properties: { limit: { type: 'integer' } },
								additionalProperties: false,
							},
							{ type: 'null' },
						],
					},
				},
			},
			execute: (args) => args,
		})

		const refused = attempt(() => tool.execute({ page: { limti: 5 } }, context))

		expect(refused.success).toBe(false)
		if (refused.success || !isToolError(refused.error))
			throw new Error('Expected an argument error')
		expect(refused.error.context?.faults).toEqual([{ reason: 'extra', path: ['page', 'limti'] }])
		expect(refused.error.message).toBe(
			'page.limti: extra; this key is not declared, remove it or use a declared key: limit',
		)
	})

	it('names null among the candidates when a nullable literal refuses', () => {
		const tool = new Tool({
			name: 'unit',
			parameters: { type: 'object', properties: { unit: { enum: ['c', null] } } },
			execute: (args) => args,
		})

		const refused = attempt(() => tool.execute({ unit: 'k' }, context))

		expect(refused.success).toBe(false)
		if (refused.success || !isToolError(refused.error))
			throw new Error('Expected an argument error')
		expect(refused.error.message).toBe(
			'unit: type; expected literal; received "k"; send one of "c", null',
		)
	})

	it('compiles a root with properties and no type as an object, and advertises it verbatim', () => {
		const parameters = {
			properties: { count: { type: 'number' } },
			required: ['count'],
		}
		const tool = new Tool({ name: 'typeless', parameters, execute: (args) => args })

		expect(tool.execute({ count: '5' }, context)).toEqual({ count: 5 })
		expect(tool.execute({ count: 5, other: 1 }, context)).toEqual({ count: 5, other: 1 })
		expect(tool.parameters).toBe(parameters)
		expect(parameters).not.toHaveProperty('type')

		const wrong = attempt(() => tool.execute({ count: 'many' }, context))
		expect(wrong.success).toBe(false)
		if (wrong.success || !isToolError(wrong.error)) throw new Error('Expected an argument error')
		expect(wrong.error.message).toBe('count: type; expected number; received "many"')

		const missing = attempt(() => tool.execute({}, context))
		expect(missing.success).toBe(false)
		if (missing.success || !isToolError(missing.error))
			throw new Error('Expected an argument error')
		expect(missing.error.message).toBe('count: missing; expected number')
	})

	it('closes a typeless root that says so, and lists its keys', () => {
		const tool = new Tool({
			name: 'typeless',
			parameters: { properties: { count: { type: 'number' } }, additionalProperties: false },
			execute: (args) => args,
		})

		const refused = attempt(() => tool.execute({ count: 5, cuont: 5 }, context))

		expect(refused.success).toBe(false)
		if (refused.success || !isToolError(refused.error))
			throw new Error('Expected an argument error')
		expect(refused.error.message).toBe(
			'cuont: extra; this key is not declared, remove it or use a declared key: count',
		)
	})

	it('refuses a non-record at a typeless root', () => {
		const tool = new Tool({
			name: 'typeless',
			parameters: { properties: { a: { type: 'string' } } },
			execute: () => 'ran',
		})

		const refused = attempt((): unknown => Reflect.apply(tool.execute, tool, ['text', context]))

		expect(refused.success).toBe(false)
		if (refused.success || !isToolError(refused.error))
			throw new Error('Expected an argument error')
		expect(refused.error.message).toBe(': type; expected object; received "text"')
		expect(tool.execute({ a: 'x' }, context)).toBe('ran')
	})

	it('keeps a nested node with properties and no type a union, which can hold a non-object', () => {
		const tool = new Tool({
			name: 'nested',
			parameters: {
				type: 'object',
				properties: { page: { properties: { count: { type: 'number' } } } },
			},
			execute: (args) => args,
		})

		const refused = attempt(() => tool.execute({ page: { count: '5' } }, context))

		expect(refused.success).toBe(false)
		if (refused.success || !isToolError(refused.error))
			throw new Error('Expected an argument error')
		expect(refused.error.message.startsWith('page: variant; ')).toBe(true)
		expect(tool.execute({ page: { count: 5 } }, context)).toEqual({ page: { count: 5 } })
		expect(tool.execute({ page: 'text' }, context)).toEqual({ page: 'text' })
	})

	it('validates with explain and forwards parsed arguments with coercion', () => {
		const shape = objectShape({ amount: numberShape() })
		const contract = createContract(shape)
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const tool = new Tool({
			name: 'amount',
			contract: shape,
			execute: recorder.handler,
		})
		const args = { amount: '3' }
		const valid = { amount: 7 }

		expect(contract.explain(args)).toEqual([])
		tool.execute(args, context)
		expect(recorder.calls[0]?.[0]).toEqual({ amount: 3 })
		expect(recorder.calls[0]?.[0]).not.toBe(args)
		expect(args).toEqual({ amount: '3' })
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

	it('reads each top-level argument once across the whole door', () => {
		const reads = createRecorder<[]>()
		const args: Readonly<Record<string, unknown>> = Object.defineProperty({}, 'amount', {
			enumerable: true,
			get: () => {
				reads.handler()
				return reads.count === 1 ? 3 : 'invalid'
			},
		})
		const tool = new Tool({
			name: 'once',
			contract: objectShape({ amount: numberShape() }),
			execute: (received) => received,
		})

		expect(tool.execute(args, context)).toEqual({ amount: 3 })
		expect(reads.count).toBe(1)
	})

	it('refuses a record it cannot read, with the read failure as the cause', () => {
		const failure = new Error('blocked read')
		const args: Readonly<Record<string, unknown>> = Object.defineProperty({}, 'amount', {
			enumerable: true,
			get: () => {
				throw failure
			},
		})
		const entered = createRecorder<[]>()
		const tool = new Tool({ name: 'blocked', strict: true, execute: entered.handler })

		const result = attempt(() => tool.execute(args, context))

		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected an argument error')
		expect(result.error.code).toBe('ARGUMENTS')
		expect(result.error.message).toBe(
			'Arguments could not be read; send one JSON object of plain values',
		)
		expect(result.error.cause).toBe(failure)
		expect(entered.count).toBe(0)
	})

	it('walks a valid record only with the guard and the parser', () => {
		const reads = createRecorder<[]>()
		const page: Readonly<Record<string, unknown>> = Object.defineProperty({}, 'limit', {
			enumerable: true,
			get: () => {
				reads.handler()
				return 3
			},
		})
		const tool = new Tool({
			name: 'fast',
			contract: objectShape({ page: objectShape({ limit: numberShape() }) }),
			execute: () => 'ran',
		})

		expect(tool.execute({ page }, context)).toBe('ran')
		expect(reads.count).toBe(2)
	})

	it('reports parse faults where parse does not hold', () => {
		const tool = new Tool({
			name: 'slow',
			contract: objectShape({ limit: numberShape() }),
			execute: () => 'ran',
		})

		const refused = attempt(() => tool.execute({ limit: 'many', extra: 1 }, context))

		expect(refused.success).toBe(false)
		if (refused.success || !isToolError(refused.error))
			throw new Error('Expected an argument error')
		expect(refused.error.context?.faults).toEqual([
			{ reason: 'type', path: ['limit'], expected: 'number', received: '"many"' },
			{ reason: 'extra', path: ['extra'] },
		])
	})

	it('refuses a nested value that stops parsing after the guard passed', () => {
		const inner = objectShape({ amount: numberShape() })
		const shape = objectShape({ page: inner })
		const reads = createRecorder<[]>()
		const page: Readonly<Record<string, unknown>> = Object.defineProperty({}, 'amount', {
			enumerable: true,
			get: () => {
				reads.handler()
				return reads.count === 1 ? 3 : 'invalid'
			},
		})
		const args = { page }
		const entered = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const tool = new Tool({ name: 'unstable', contract: shape, execute: entered.handler })

		const result = attempt(() => tool.execute(args, context))

		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected a parse error')
		expect(result.error.code).toBe('ARGUMENTS')
		expect(result.error.message).toBe(
			'Arguments did not parse to a record; send one JSON object holding the declared keys',
		)
		expect(result.error.context).toBeUndefined()
		expect(entered.count).toBe(0)
	})

	it('validates an advertised schema through its lenient conversion', () => {
		const tool = new Tool({
			name: 'add',
			parameters: {
				type: 'object',
				properties: { left: { type: 'number' }, right: { type: 'number' } },
				required: ['left', 'right'],
			},
			execute: (args) => Number(args.left) + Number(args.right),
		})

		const missing = attempt(() => tool.execute({}, context))
		expect(missing.success).toBe(false)
		if (missing.success || !isToolError(missing.error))
			throw new Error('Expected an argument error')
		expect(missing.error.code).toBe('ARGUMENTS')
		expect(missing.error.context?.faults).toEqual([
			{ reason: 'missing', path: ['left'], expected: 'number' },
			{ reason: 'missing', path: ['right'], expected: 'number' },
		])
		const wrong = attempt(() => tool.execute({ left: 'invalid', right: 2 }, context))
		expect(wrong.success).toBe(false)
		expect(tool.execute({ left: 2, right: 3 }, context)).toBe(5)
	})

	it('hands a declared object over as a null-prototype copy at every declared level', () => {
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const tool = new Tool({
			name: 'declared',
			contract: objectShape({ page: objectShape({ limit: numberShape() }) }),
			execute: recorder.handler,
		})
		const args = { page: { limit: 1 } }

		tool.execute(args, context)
		const received = recorder.calls[0]?.[0]

		expect(received).toEqual(args)
		expect(received).not.toBe(args)
		expect(received?.page).not.toBe(args.page)
		expect(Object.getPrototypeOf(received)).toBeNull()
		expect(() => String(received)).toThrow(TypeError)
		expect(Reflect.get(received ?? {}, 'hasOwnProperty')).toBeUndefined()
		expect(Object.keys(received ?? {})).toEqual(['page'])
	})

	it('copies only the top level of an open object, and hands nested values by reference', () => {
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const tool = new Tool({
			name: 'open',
			parameters: { type: 'object' },
			execute: recorder.handler,
		})
		const args = { page: { limit: 1 } }

		tool.execute(args, context)
		const received = recorder.calls[0]?.[0]

		expect(received).not.toBe(args)
		expect(received?.page).toBe(args.page)
		expect(Object.getPrototypeOf(received)).toBeNull()
	})

	it('hands a raw root over as a plain top-level copy, with nested values by reference', () => {
		const rows: ReadonlyArray<Readonly<Record<string, unknown>>> = [
			{},
			{ $ref: '#/$defs/page', $defs: { page: { type: 'object' } } },
		]
		const misses = rows.filter((parameters) => {
			const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
			const tool = new Tool({ name: 'raw', parameters, execute: recorder.handler })
			const args = { page: { limit: 1 } }
			tool.execute(args, context)
			const received = recorder.calls[0]?.[0]
			return (
				received === args ||
				received?.page !== args.page ||
				Object.getPrototypeOf(received) !== Object.prototype
			)
		})

		expect(misses).toEqual([])
	})

	it('reads a parameters record once, so a later mutation leaves the door behind', () => {
		const parameters: { type: string; additionalProperties: boolean; properties: object } = {
			type: 'object',
			additionalProperties: false,
			properties: { before: { type: 'string' } },
		}
		const tool = new Tool({ name: 'drift', parameters, execute: () => 'ran' })

		expect(tool.execute({ before: 'x' }, context)).toBe('ran')
		parameters.properties = { after: { type: 'string' } }

		expect(tool.parameters?.properties).toEqual({ after: { type: 'string' } })
		expect(tool.execute({ before: 'x' }, context)).toBe('ran')
		expect(attempt(() => tool.execute({ after: 'x' }, context)).success).toBe(false)
	})

	it('holds a schema closed only where it says so', () => {
		const properties = { amount: { type: 'number' } }
		const closed = new Tool({
			name: 'closed',
			parameters: { type: 'object', properties, additionalProperties: false },
			execute: (args) => args,
		})
		const absent = new Tool({
			name: 'absent',
			parameters: { type: 'object', properties },
			execute: (args) => args,
		})
		const open = new Tool({
			name: 'open',
			parameters: { type: 'object', properties, additionalProperties: true },
			execute: (args) => args,
		})

		const refused = attempt(() => closed.execute({ amount: 1, extra: 2 }, context))
		expect(refused.success).toBe(false)
		if (refused.success || !isToolError(refused.error))
			throw new Error('Expected an argument error')
		expect(refused.error.context?.faults).toEqual([{ reason: 'extra', path: ['extra'] }])
		expect(absent.execute({ amount: 1, extra: 2 }, context)).toEqual({ amount: 1, extra: 2 })
		expect(open.execute({ amount: 1, extra: 2 }, context)).toEqual({ amount: 1, extra: 2 })
	})

	for (const [title, parameters, args] of SCHEMA_VALID_CALLS) {
		it(`accepts what the schema accepts: ${title}`, () => {
			const tool = new Tool({ name: 'valid', parameters, execute: (received) => received })

			expect(tool.execute(args, context)).toEqual(args)
		})
	}

	for (const [title, parameters, args] of SCHEMA_DEFAULT_CALLS) {
		it(`accepts a schema wherever its default sits: ${title}`, () => {
			const tool = new Tool({ name: 'defaulted', parameters, execute: (received) => received })

			expect(tool.execute(args, context)).toMatchObject(args)
		})
	}

	it('fills a schema default under a closed object and leaves it absent under an open one', () => {
		const properties = { limit: { type: 'number', default: 3 } }
		const closed = new Tool({
			name: 'closed',
			parameters: { type: 'object', properties, additionalProperties: false },
			execute: (args) => args,
		})
		const open = new Tool({
			name: 'open',
			parameters: { type: 'object', properties },
			execute: (args) => args,
		})

		expect(closed.execute({}, context)).toEqual({ limit: 3 })
		expect(closed.execute({ limit: 5 }, context)).toEqual({ limit: 5 })
		expect(open.execute({}, context)).toEqual({})
		expect(open.execute({ limit: 5 }, context)).toEqual({ limit: 5 })
	})

	it('compiles a schema on the first execute and only once', () => {
		const reads = createRecorder<[]>()
		const parameters = Object.defineProperty({ type: 'object' }, 'properties', {
			enumerable: true,
			get: () => {
				reads.handler()
				return { amount: { type: 'number' } }
			},
		})
		const tool = new Tool({ name: 'lazy', parameters, execute: (args) => args.amount })

		expect(reads.count).toBe(0)
		expect(tool.parameters).toBe(parameters)
		expect(tool.execute({ amount: 1 }, context)).toBe(1)
		const compiled = reads.count
		expect(compiled).toBeGreaterThan(0)
		expect(tool.execute({ amount: 2 }, context)).toBe(2)
		expect(reads.count).toBe(compiled)
	})

	it('compiles nothing when a hundred tools with wide schemas are built', () => {
		const reads = createRecorder<[]>()
		const tools = Array.from({ length: 100 }, (_unused, index) => {
			const parameters = Object.defineProperty({ type: 'object' }, 'properties', {
				enumerable: true,
				get: () => {
					reads.handler()
					return Object.fromEntries(
						Array.from({ length: 12 }, (_field, field) => [
							`field${String(field)}`,
							{ type: 'string' },
						]),
					)
				},
			})
			return new Tool({ name: `tool${String(index)}`, parameters, execute: () => index })
		})

		expect(tools).toHaveLength(100)
		expect(reads.count).toBe(0)
		attempt(() => tools[0]?.execute({}, context))
		expect(reads.count).toBeGreaterThan(0)
	})

	it('throws a SCHEMA error from execute when the schema cannot be converted', () => {
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const tool = new Tool({
			name: 'broken',
			parameters: createUnreadableSchema(),
			execute: recorder.handler,
		})

		const result = attempt(() => tool.execute({}, context))

		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected a schema error')
		expect(result.error.code).toBe('SCHEMA')
		expect(result.error.message).toBe(
			'Tool "broken" cannot compile its parameters schema; pass a JSON Schema built from plain values, or set strict: false to forward arguments unchecked',
		)
		expect(isContractError(result.error.cause)).toBe(true)
		expect(recorder.count).toBe(0)
	})

	for (const [title, parameters] of NON_RECORD_PARAMETERS) {
		for (const strict of [true, false]) {
			it(`refuses ${title} as parameters when strict is ${String(strict)}`, () => {
				const result = attempt((): unknown =>
					Reflect.construct(Tool, [{ name: 'bad', parameters, strict, execute: () => 'ran' }]),
				)

				expect(result.success).toBe(false)
				if (result.success || !isToolError(result.error)) throw new Error('Expected a schema error')
				expect(result.error.code).toBe('SCHEMA')
			})
		}
	}

	it('names the remedy when it refuses parameters', () => {
		const result = attempt((): unknown =>
			Reflect.construct(Tool, [{ name: 'bad', parameters: 5, execute: () => 'ran' }]),
		)

		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected a schema error')
		expect(result.error.message).toBe(
			'Tool "bad" needs parameters that are a plain JSON Schema record; received 5; pass an object such as { type: \'object\', properties: {} }, or leave parameters out',
		)
	})

	it('compiles a contract at construction, failing an owned declaration early', () => {
		const result = attempt((): unknown =>
			Reflect.construct(Tool, [
				{ name: 'early', contract: { unknown: 'shape' }, execute: () => 0 },
			]),
		)

		expect(result.success).toBe(false)
		if (result.success) throw new Error('Expected a construction refusal')
		expect(isContractError(result.error)).toBe(true)
	})

	it('forwards verbatim under strict false, with nothing compiled and the schema untouched', () => {
		const reads = createRecorder<[]>()
		const parameters = Object.defineProperty({ type: 'object' }, 'properties', {
			enumerable: true,
			get: () => {
				reads.handler()
				return {}
			},
		})
		const tool = new Tool({
			name: 'raw',
			parameters,
			strict: false,
			execute: (args) => args,
		})
		const args = { x: 1 }

		expect(tool.execute(args, context)).toBe(args)
		expect(tool.parameters).toBe(parameters)
		expect(reads.count).toBe(0)
	})

	it('forwards a closed schema unchecked under strict false', () => {
		const tool = new Tool({
			name: 'raw',
			parameters: { type: 'object', properties: {}, additionalProperties: false },
			strict: false,
			execute: (args) => args.x,
		})

		expect(tool.execute({ x: 1 }, context)).toBe(1)
	})

	it('derives the advertised schema from a contract and forwards verbatim under strict false', () => {
		const shape = objectShape({ amount: numberShape() })
		const tool = new Tool({ name: 'raw', contract: shape, strict: false, execute: (args) => args })
		const args = { amount: 'invalid', extra: 1 }

		expect(tool.parameters).toEqual(schemaToParameters(createContract(shape).schema))
		expect(tool.execute(args, context)).toBe(args)
	})

	it('reads every strict value but false as strict', () => {
		const values: readonly unknown[] = [undefined, true, 'false', 0, null]
		const lenient = values.filter((strict) => {
			const tool: unknown = Reflect.construct(Tool, [
				{ name: 'closed', strict, execute: () => 'ran' },
			])
			return attempt((): unknown =>
				Reflect.apply(Tool.prototype.execute, tool, [{ x: 1 }, context]),
			).success
		})

		expect(lenient).toEqual([])
	})

	it('advertises and enforces the closed empty schema when nothing is declared', () => {
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const tool = new Tool({ name: 'bare', execute: recorder.handler })

		expect(tool.parameters).toBe(CLOSED_PARAMETERS)
		expect(CLOSED_PARAMETERS).toEqual({
			type: 'object',
			properties: {},
			additionalProperties: false,
		})
		const result = attempt(() => tool.execute({ x: 1 }, context))
		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected an argument error')
		expect(result.error.code).toBe('ARGUMENTS')
		expect(result.error.context?.faults).toEqual([{ reason: 'extra', path: ['x'] }])
		expect(recorder.count).toBe(0)
		tool.execute({}, context)
		expect(recorder.count).toBe(1)
	})

	it('advertises an open object when nothing is declared and strict is false', () => {
		const tool = new Tool({ name: 'raw', strict: false, execute: (args) => args.x })

		expect(tool.parameters).toBe(OPEN_PARAMETERS)
		expect(OPEN_PARAMETERS).toEqual({ type: 'object' })
		expect(tool.execute({ x: 1 }, context)).toBe(1)
	})

	it('refuses a name that is not a non-empty trimmed string', () => {
		const names: readonly unknown[] = ['', ' ', '\t', ' add', 'add ', undefined, null, 5, {}]
		const misses = names.filter((name) => {
			const result = attempt((): unknown => Reflect.construct(Tool, [{ name, execute: () => 0 }]))
			return result.success || !isToolError(result.error) || result.error.code !== 'SCHEMA'
		})

		expect(misses).toEqual([])
	})

	it('names the remedy when it refuses a name', () => {
		const result = attempt(() => new Tool({ name: ' ', execute: () => 0 }))

		expect(result.success).toBe(false)
		if (result.success || !isToolError(result.error)) throw new Error('Expected a schema error')
		expect(result.error.message).toBe(
			'A tool name must be a non-empty string with no surrounding space; received " "',
		)
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
		expect(description.parameters).toBe(CLOSED_PARAMETERS)
		expect(schema.description).toBeUndefined()
		expect(schema.parameters).toBe(parameters)
		expect(bare.description).toBeUndefined()
		expect(bare.summary).toBeUndefined()
		expect(bare.parameters).toBe(CLOSED_PARAMETERS)
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
