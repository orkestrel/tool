import { createContract } from '@orkestrel/contract'
import { describe, expect, it } from 'vitest'
import {
	MALFORMED_CALLS,
	NON_RECORD_PARAMETERS,
	OPEN_ARGUMENTS,
	PET_PARAMETERS,
	SCHEMA_DEFAULT_CALLS,
	SCHEMA_VALID_CALLS,
	createChainArguments,
	createChainSchema,
	createToolCall,
	createUnreadableSchema,
} from './setup.js'

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

describe('createUnreadableSchema', () => {
	it('throws on the properties read and keeps the key enumerable', () => {
		const schema = createUnreadableSchema()

		expect(() => schema.properties).toThrow('blocked string conversion')
		expect(Object.keys(schema)).toEqual(['type', 'properties'])
	})
})

describe('createChainSchema and createChainArguments', () => {
	it('nest the same depth, so the chain schema reads the chain record', () => {
		expect(createChainSchema(1)).toEqual({
			type: 'object',
			properties: {
				child: { type: 'object', properties: {}, additionalProperties: false },
			},
			additionalProperties: false,
		})
		expect(createChainArguments(1, ['a', 'b'])).toEqual({ child: { a: 1, b: 1 } })
	})
})

describe('PET_PARAMETERS', () => {
	it('declares each key in one arm alone', () => {
		const { pet } = { pet: JSON.stringify(PET_PARAMETERS) }

		expect(pet.match(/"x":/gu)).toHaveLength(1)
		expect(pet.match(/"y":/gu)).toHaveLength(1)
	})
})

describe('OPEN_ARGUMENTS', () => {
	it('admits arbitrary keys strictly and keeps them through parse', () => {
		const contract = createContract(OPEN_ARGUMENTS)

		expect(contract.audit({ a: 1, b: 'x' })).toEqual([])
		expect(contract.parse({ a: 1, b: 'x' })).toEqual({ a: 1, b: 'x' })
	})
})

describe('call and schema tables', () => {
	it('titles every non-record parameter value once', () => {
		expect(new Set(NON_RECORD_PARAMETERS.map(([title]) => title)).size).toBe(
			NON_RECORD_PARAMETERS.length,
		)
	})

	it('titles every malformed call once', () => {
		expect(new Set(MALFORMED_CALLS.map(([title]) => title)).size).toBe(MALFORMED_CALLS.length)
	})

	it('titles every schema-valid call once, each with a record to send', () => {
		expect(new Set(SCHEMA_VALID_CALLS.map(([title]) => title)).size).toBe(SCHEMA_VALID_CALLS.length)
		expect(SCHEMA_VALID_CALLS.filter(([, , args]) => Object.keys(args).length === 0)).toEqual([])
	})

	it('titles every default placement once, each schema carrying a default', () => {
		expect(new Set(SCHEMA_DEFAULT_CALLS.map(([title]) => title)).size).toBe(
			SCHEMA_DEFAULT_CALLS.length,
		)
		expect(
			SCHEMA_DEFAULT_CALLS.filter(
				([, parameters]) => !JSON.stringify(parameters).includes('"default"'),
			),
		).toEqual([])
	})
})
