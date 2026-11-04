import {
	CLOSED_PARAMETERS,
	Tool,
	buildCallRefusal,
	parametersToSchema,
	readCall,
	toolToDefinition,
} from '@src/core'
import { createRecorder } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { MALFORMED_CALLS, OPEN_ARGUMENTS, refuseConversion } from '../../setup.js'

describe('toolToDefinition', () => {
	it('projects the name and the closed schema when nothing else was authored', () => {
		const tool = new Tool({ name: 'echo', execute: () => undefined })

		const definition = toolToDefinition(tool)

		expect(definition).toEqual({ name: 'echo', parameters: CLOSED_PARAMETERS })
		expect(Object.keys(definition)).toEqual(['name', 'parameters'])
	})

	it('advertises the summary in place of the full description', () => {
		const tool = new Tool({
			name: 'add',
			description: 'Add two numeric values and return their sum.',
			summary: 'Add two numbers.',
			execute: () => 0,
		})

		expect(toolToDefinition(tool)).toEqual({
			name: 'add',
			description: 'Add two numbers.',
			parameters: CLOSED_PARAMETERS,
		})
		expect(tool.description).toBe('Add two numeric values and return their sum.')
	})

	it('advertises the full description when no summary was authored', () => {
		const tool = new Tool({
			name: 'now',
			description: 'Current epoch milliseconds.',
			execute: () => 0,
		})

		expect(toolToDefinition(tool)).toEqual({
			name: 'now',
			description: 'Current epoch milliseconds.',
			parameters: CLOSED_PARAMETERS,
		})
	})

	it('carries the parameter schema by reference and orders the projected keys', () => {
		const parameters = { type: 'object', properties: { value: { type: 'string' } } }
		const tool = new Tool({
			name: 'echo',
			description: 'Echo a value.',
			parameters,
			execute: (args) => args.value,
		})

		const definition = toolToDefinition(tool)

		expect(Object.keys(definition)).toEqual(['name', 'description', 'parameters'])
		expect(definition.parameters).toBe(parameters)
	})

	it('forwards title and annotations while substituting summary for description', () => {
		const annotations = { pure: true, untrusted: false, consequential: false }
		const tool = new Tool({
			name: 'echo',
			title: 'Echo',
			description: 'Full description',
			summary: 'Echo a value',
			annotations,
			contract: OPEN_ARGUMENTS,
			execute: (args) => args.value,
		})

		const definition = toolToDefinition(tool)

		expect(definition).toEqual({
			name: 'echo',
			title: 'Echo',
			description: 'Echo a value',
			parameters: tool.parameters,
			annotations,
		})
		expect(definition.annotations).toBe(annotations)
		expect(Object.keys(definition)).toEqual([
			'name',
			'title',
			'description',
			'parameters',
			'annotations',
		])
		expect(definition).not.toHaveProperty('summary')
		expect(definition).not.toHaveProperty('signal')
		expect(definition).not.toHaveProperty('caller')
	})

	it('projects a fresh object on every call', () => {
		const tool = new Tool({ name: 'echo', execute: () => undefined })

		expect(toolToDefinition(tool)).not.toBe(toolToDefinition(tool))
	})
})

describe('parametersToSchema', () => {
	it('reads a root with properties and no type as an object, leaving the record alone', () => {
		const parameters = { properties: { a: { type: 'string' } }, required: ['a'] }

		expect(parametersToSchema(parameters)).toEqual({
			type: 'object',
			properties: { a: { type: 'string' } },
			required: ['a'],
		})
		expect(parameters).not.toHaveProperty('type')
	})

	it('returns every other record as it is', () => {
		const rows: ReadonlyArray<Readonly<Record<string, unknown>>> = [
			{},
			{ type: 'object' },
			{ type: 'object', properties: {} },
			{ type: 'array', properties: {} },
			{ anyOf: [{ type: 'string' }] },
			{ $ref: '#/$defs/a' },
		]

		expect(rows.filter((row) => parametersToSchema(row) !== row)).toEqual([])
	})
})

describe('readCall', () => {
	it('reads each member once into a plain record', () => {
		const reads = createRecorder<[string]>()

		const read = readCall({
			get id() {
				reads.handler('id')
				return 'a'
			},
			get name() {
				reads.handler('name')
				return 'b'
			},
			get arguments() {
				reads.handler('arguments')
				return {}
			},
		})

		expect(read).toEqual({ id: 'a', name: 'b', arguments: {} })
		expect(reads.calls).toEqual([['id'], ['name'], ['arguments']])
	})

	it('reads nothing from a value that is not an object', () => {
		expect(readCall(undefined)).toEqual({})
		expect(readCall('call')).toEqual({})
		expect(readCall(null)).toEqual({})
	})

	it('reads a throwing arguments accessor as absent and lets an id accessor throw', () => {
		expect(
			readCall(
				Object.defineProperty({ id: 'a', name: 'b' }, 'arguments', { get: refuseConversion }),
			),
		).toEqual({ id: 'a', name: 'b', arguments: undefined })
		expect(() =>
			readCall(
				Object.defineProperty({ name: 'b', arguments: {} }, 'id', { get: refuseConversion }),
			),
		).toThrow('blocked string conversion')
	})
})

describe('buildCallRefusal', () => {
	it('carries each string member and blanks the rest', () => {
		const misses = MALFORMED_CALLS.filter(([, call, id, name]) => {
			const refusal = buildCallRefusal(call)
			return refusal.id !== id || refusal.name !== name || refusal.success
		}).map(([title]) => title)

		expect(misses).toEqual([])
	})

	it('names the envelope a call must have', () => {
		expect(buildCallRefusal(undefined).error).toBe(
			'malformed call: a call needs a string id, a string name, and a plain record of arguments',
		)
	})
})
