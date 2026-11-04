import type { AuditFault } from '@orkestrel/contract'
import {
	FAULT_LIMIT,
	createContract,
	numberShape,
	objectShape,
	schemaToShape,
	stringShape,
	unionShape,
} from '@orkestrel/contract'
import {
	CLOSED_PARAMETERS,
	REFUSAL_LIST_LIMIT,
	REFUSAL_SCHEMA_LIMIT,
	REFUSAL_TEXT_LIMIT,
	Tool,
	buildCallRefusal,
	describeFaultLine,
	describeFaults,
	extractPath,
	extractSchema,
	readCall,
	renderList,
	renderPath,
	scanFaults,
	toolToDefinition,
} from '@src/core'
import { createRecorder } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import {
	MALFORMED_CALLS,
	OPEN_ARGUMENTS,
	PET_PARAMETERS,
	SCHEMA_DEFAULT_CALLS,
	SCHEMA_VALID_CALLS,
	refuseConversion,
} from '../../setup.js'

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

describe('scanFaults', () => {
	const closed = createContract(objectShape({ amount: numberShape() }))

	it('reports nothing for a valid record and for a coercible leaf', () => {
		expect(scanFaults(closed, { amount: 3 })).toEqual([])
		expect(scanFaults(closed, { amount: '3' })).toEqual([])
	})

	it('reports an undeclared key alone, leaving a coercible leaf out of the refusal', () => {
		expect(scanFaults(closed, { amount: '3', extra: 1 })).toEqual([
			{ reason: 'extra', path: ['extra'] },
		])
	})

	it('reports a parse fault and an undeclared key in one report', () => {
		expect(scanFaults(closed, { amount: 'invalid', extra: 1 })).toEqual([
			{ reason: 'type', path: ['amount'], expected: 'number', received: '"invalid"' },
			{ reason: 'extra', path: ['extra'] },
		])
	})

	it('reports a union a coercion would repair by declaration order', () => {
		const union = createContract(
			objectShape({
				value: unionShape(
					objectShape({ amount: numberShape() }),
					objectShape({ name: stringShape() }),
				),
			}),
		)

		expect(union.explain({ value: { amount: '500' } })).toEqual([])
		expect(scanFaults(union, { value: { amount: '500' } })).toEqual([
			{ reason: 'variant', path: ['value'], variants: 2 },
		])
	})

	it('leaves out what one arm of a union reported under the fault that covers it', () => {
		const pets = createContract(schemaToShape(PET_PARAMETERS))
		const value = { pet: { kind: 'b', y: '5' } }

		expect(pets.audit(value).filter((fault) => fault.reason === 'extra')).toEqual([
			{ reason: 'extra', path: ['pet', 'y'] },
		])
		expect(scanFaults(pets, value)).toEqual([{ reason: 'variant', path: ['pet'], variants: 2 }])
	})

	it('keeps a fault beside a union, and the union beside a parse fault elsewhere', () => {
		const shape = objectShape({
			count: numberShape(),
			choice: unionShape(
				objectShape({ amount: numberShape() }),
				objectShape({ name: stringShape() }),
			),
		})
		const contract = createContract(shape)

		expect(
			scanFaults(contract, { count: 'many', choice: { amount: '5', typo: 1 }, extra: 1 }),
		).toEqual([
			{ reason: 'type', path: ['count'], expected: 'number', received: '"many"' },
			{ reason: 'variant', path: ['choice'], variants: 2 },
			{ reason: 'extra', path: ['extra'] },
		])
	})

	it('reports a fault at the same path once', () => {
		const contract = createContract(
			objectShape({ choice: unionShape(numberShape(), stringShape({ min: 3 })) }),
		)

		expect(scanFaults(contract, { choice: {} })).toEqual([
			{ reason: 'variant', path: ['choice'], variants: 2 },
		])
	})

	it('returns nothing on the guard alone only where both reports are empty', () => {
		const rows = [...SCHEMA_VALID_CALLS, ...SCHEMA_DEFAULT_CALLS].map(
			([title, parameters, args]) => {
				const contract = createContract(schemaToShape(parameters))
				return {
					title,
					is: contract.is(args),
					reports: [...contract.explain(args), ...contract.audit(args)],
				}
			},
		)

		expect(rows.filter((row) => row.is && row.reports.length > 0)).toEqual([])
		expect(rows.filter((row) => row.is).length).toBeGreaterThan(0)
	})

	it('reports a full audit whose cap could hide an undeclared key', () => {
		const shape = objectShape(
			Object.fromEntries(
				Array.from({ length: FAULT_LIMIT + 6 }, (_, index) => [
					`key${String(index)}`,
					numberShape(),
				]),
			),
		)
		const contract = createContract(shape)
		const value = {
			...Object.fromEntries(
				Array.from({ length: FAULT_LIMIT + 6 }, (_, index) => [
					`key${String(index)}`,
					String(index),
				]),
			),
			unknown: 1,
		}

		const faults = scanFaults(contract, value)

		expect(contract.explain(value)).toEqual([])
		expect(contract.audit(value).filter((fault) => fault.reason === 'extra')).toEqual([])
		expect(faults).toHaveLength(FAULT_LIMIT)
		expect(faults.filter((fault) => fault.reason !== 'type')).toEqual([])
	})

	it('bounds a mixed report at the fault limit', () => {
		const value = Object.fromEntries(
			Array.from({ length: FAULT_LIMIT + 6 }, (_, index) => [`key${String(index)}`, index]),
		)

		expect(scanFaults(closed, value).length).toBeLessThanOrEqual(FAULT_LIMIT)
	})
})

describe('extractPath', () => {
	it('reads an array path as it is and a string path as one segment', () => {
		expect(extractPath({ reason: 'extra', path: ['a', 'b'] })).toEqual(['a', 'b'])
		expect(extractPath({ reason: 'extra', path: 'a' })).toEqual(['a'])
		expect(extractPath({ reason: 'extra', path: [] })).toEqual([])
	})
})

describe('extractSchema', () => {
	const leaf = { type: 'number' } as const
	const closed = { type: 'object', properties: { leaf } } as const

	it('walks properties, items, record values, and the arms of a union', () => {
		expect(extractSchema(closed, [])).toBe(closed)
		expect(extractSchema(closed, ['leaf'])).toBe(leaf)
		expect(extractSchema({ type: 'array', items: closed }, ['3', 'leaf'])).toBe(leaf)
		expect(extractSchema({ type: 'object', additionalProperties: closed }, ['any', 'leaf'])).toBe(
			leaf,
		)
		expect(extractSchema({ anyOf: [closed, { type: 'null' }] }, ['leaf'])).toBe(leaf)
	})

	it('returns undefined past what the schema declares, without reading the prototype', () => {
		expect(extractSchema(closed, ['absent'])).toBeUndefined()
		expect(extractSchema(closed, ['leaf', 'absent'])).toBeUndefined()
		expect(extractSchema(closed, ['constructor'])).toBeUndefined()
		expect(extractSchema(closed, ['__proto__'])).toBeUndefined()
	})

	it('stops on a union that nests itself, because each step takes a key', () => {
		const cycle: { anyOf: unknown[] } = { anyOf: [] }
		cycle.anyOf.push(cycle)

		expect(Reflect.apply(extractSchema, undefined, [cycle, ['a', 'b']])).toBeUndefined()
	})
})

describe('renderPath', () => {
	it('joins plain identifiers and renders a root as empty', () => {
		expect(renderPath(['profile', 'age', '0'])).toBe('profile.age.0')
		expect(renderPath([])).toBe('')
	})

	it('encodes and caps a segment that is not a plain identifier', () => {
		expect(renderPath(['line\nbreak'])).toBe('"line\\nbreak"')
		expect(renderPath(['a.b'])).toBe('"a.b"')
		expect(renderPath([''])).toBe('""')
		expect(renderPath(['x'.repeat(5000)]).length).toBeLessThan(100)
	})

	it('elides the middle of a long path and keeps both ends', () => {
		const path = Array.from({ length: 40 }, (_, index) => `level${String(index)}`)

		expect(renderPath(path)).toBe('level0.….level37.level38.level39')
	})
})

describe('renderList', () => {
	it('joins a short list whole', () => {
		expect(renderList(['a', 'b'])).toBe('a, b')
		expect(renderList([])).toBe('')
	})

	it('bounds a long list and says how many it left out', () => {
		const names = Array.from({ length: REFUSAL_LIST_LIMIT + 5 }, (_, index) => `k${String(index)}`)

		const text = renderList(names)

		expect(text.split(', ')).toHaveLength(REFUSAL_LIST_LIMIT)
		expect(text.endsWith(' and 5 more')).toBe(true)
	})
})

describe('describeFaultLine', () => {
	it('lists the keys declared where an undeclared key sits', () => {
		expect(
			describeFaultLine(
				{ reason: 'extra', path: ['temprature'] },
				{
					type: 'object',
					properties: { city: { type: 'string' }, temperature: { type: 'number' } },
				},
			),
		).toBe(
			'temprature: extra; this key is not declared, remove it or use a declared key: city, temperature',
		)
	})

	it('reads the declared keys at the parent of a nested key', () => {
		expect(
			describeFaultLine(
				{ reason: 'extra', path: ['rows', '0', 'typo'] },
				{
					type: 'object',
					properties: {
						rows: {
							type: 'array',
							items: { type: 'object', properties: { id: { type: 'number' } } },
						},
					},
				},
			),
		).toBe('rows.0.typo: extra; this key is not declared, remove it or use a declared key: id')
	})

	it('says only to remove a key where nothing is declared', () => {
		expect(describeFaultLine({ reason: 'extra', path: ['x'] }, CLOSED_PARAMETERS)).toBe(
			'x: extra; this key is not declared, remove it',
		)
	})

	it('bounds and encodes the declared keys', () => {
		const properties = Object.fromEntries(
			Array.from({ length: 40 }, (_, index) => [`${'k'.repeat(5000)}${String(index)}`, {}]),
		)

		const line = describeFaultLine({ reason: 'extra', path: ['x'] }, { type: 'object', properties })

		expect(line.length).toBeLessThan(1200)
		expect(line.endsWith(' and 28 more')).toBe(true)
	})

	it('names the candidates of a literal, on a type fault and a missing one', () => {
		const schema = { type: 'object', properties: { unit: { enum: ['c', 'f'] } } } as const

		expect(
			describeFaultLine(
				{ reason: 'type', path: ['unit'], expected: 'literal', received: '"k"' },
				schema,
			),
		).toBe('unit: type; expected literal; received "k"; send one of "c", "f"')
		expect(
			describeFaultLine({ reason: 'missing', path: ['unit'], expected: 'literal' }, schema),
		).toBe('unit: missing; expected literal; send one of "c", "f"')
	})

	it('names null among the candidates of a nullable literal', () => {
		expect(
			describeFaultLine(
				{ reason: 'type', path: ['unit'], expected: 'literal', received: '"k"' },
				{
					type: 'object',
					properties: { unit: { anyOf: [{ enum: ['c'] }, { type: 'null' }] } },
				},
			),
		).toBe('unit: type; expected literal; received "k"; send one of "c", null')
	})

	it('bounds the candidates of a long literal', () => {
		const values = Array.from({ length: 50 }, (_, index) => `${'v'.repeat(5000)}${String(index)}`)

		const line = describeFaultLine(
			{ reason: 'type', path: ['unit'], expected: 'literal', received: '"k"' },
			{ type: 'object', properties: { unit: { enum: values } } },
		)

		expect(line.length).toBeLessThan(1200)
		expect(line.endsWith(' and 38 more')).toBe(true)
	})

	it('says what a variant must be, with the schema of the path when it is short', () => {
		const forms = { anyOf: [{ type: 'integer' }, { type: 'boolean' }] } as const

		expect(
			describeFaultLine(
				{ reason: 'variant', path: ['limit'], variants: 2 },
				{ type: 'object', properties: { limit: forms } },
			),
		).toBe(
			`limit: variant; the value matches none of the 2 declared forms; send it exactly as the schema declares: ${JSON.stringify(forms)}`,
		)
	})

	it('leaves out a schema longer than its limit', () => {
		const forms = {
			anyOf: Array.from({ length: 12 }, (_, index) => ({ enum: [`form${String(index)}`] })),
		}

		expect(JSON.stringify(forms).length).toBeGreaterThan(REFUSAL_SCHEMA_LIMIT)
		expect(
			describeFaultLine(
				{ reason: 'variant', path: ['limit'], variants: 12 },
				{ type: 'object', properties: { limit: forms } },
			),
		).toBe(
			'limit: variant; the value matches none of the 12 declared forms; send it exactly as the schema declares',
		)
	})

	it('says what a oneOf must be, whether it matched none or several', () => {
		const forms = { oneOf: [{ type: 'object' }, { type: 'object' }] } as const
		const tail = `send it exactly as the schema declares: ${JSON.stringify(forms)}`

		expect(describeFaultLine({ reason: 'oneOf', path: [], matched: 0 }, forms)).toBe(
			`: oneOf; the value matches none of the 2 declared forms; ${tail}`,
		)
		expect(describeFaultLine({ reason: 'oneOf', path: [], matched: 2 }, forms)).toBe(
			`: oneOf; the value matches 2 of the 2 declared forms and must match exactly one; ${tail}`,
		)
	})

	it('says what a union must be where the path leaves the schema', () => {
		expect(describeFaultLine({ reason: 'oneOf', path: ['gone'], matched: 0 }, {})).toBe(
			'gone: oneOf; the value matches none of the declared forms; send it exactly as the schema declares',
		)
		expect(describeFaultLine({ reason: 'variant', path: ['gone'], variants: 2 }, {})).toBe(
			'gone: variant; the value matches none of the 2 declared forms; send it exactly as the schema declares',
		)
	})
})

describe('describeFaults', () => {
	it('names one fault on one line, in the shape a reader corrects from', () => {
		const faults: readonly AuditFault[] = [
			{ reason: 'type', path: ['profile', 'age'], expected: 'number', received: '"invalid"' },
			{ reason: 'missing', path: ['name'], expected: 'string' },
			{
				reason: 'constraint',
				path: ['amount'],
				expected: 'number',
				constraint: 'min',
				limit: 1,
				received: '0',
			},
			{ reason: 'variant', path: ['choice'], variants: 2 },
			{ reason: 'oneOf', path: [], matched: 2 },
			{ reason: 'extra', path: ['zzz'] },
		]

		expect(describeFaults(faults, {}).split('\n')).toEqual([
			'profile.age: type; expected number; received "invalid"',
			'name: missing; expected string',
			'amount: constraint; expected number; received 0; constraint min; limit 1',
			'choice: variant; the value matches none of the 2 declared forms; send it exactly as the schema declares',
			': oneOf; the value matches 2 of the declared forms and must match exactly one; send it exactly as the schema declares',
			'zzz: extra; this key is not declared, remove it',
		])
	})

	it('encodes a key that is not a plain identifier and caps its length', () => {
		const long = 'x'.repeat(5000)

		const text = describeFaults(
			[
				{ reason: 'extra', path: ['line\nbreak'] },
				{ reason: 'extra', path: [long] },
				{ reason: 'extra', path: ['ok_key-1', '0'] },
			],
			{},
		)
		const lines = text.split('\n')

		expect(lines).toHaveLength(3)
		expect(lines[0]).toBe('"line\\nbreak": extra; this key is not declared, remove it')
		expect(lines[1]?.length).toBeLessThan(200)
		expect(lines[2]).toBe('ok_key-1.0: extra; this key is not declared, remove it')
	})

	it('says that a full report stops at its limit, when every line fits', () => {
		const faults = Array.from({ length: FAULT_LIMIT }, (_, index): AuditFault => ({
			reason: 'missing',
			path: [`k${String(index)}`],
			expected: 'string',
		}))

		const lines = describeFaults(faults, {}).split('\n')

		expect(lines).toHaveLength(FAULT_LIMIT + 1)
		expect(lines.at(-1)).toBe(
			`the report stops at ${String(FAULT_LIMIT)}; correct these and call again`,
		)
	})

	it('keeps a report under its limit and ends with how many more faults there are', () => {
		const faults = Array.from({ length: 40 }, (_, index): AuditFault => ({
			reason: 'missing',
			path: [`key${String(index)}`, 'x'.repeat(5000)],
			expected: 'string',
		}))

		const lines = describeFaults(faults, {}).split('\n')

		expect(lines.join('\n').length).toBeLessThanOrEqual(REFUSAL_TEXT_LIMIT)
		const kept = lines.length - 1
		expect(kept).toBeGreaterThan(0)
		expect(lines.at(-1)).toBe(`and ${String(40 - kept)} more faults; correct these and call again`)
	})

	it('adds no closing line to a report that fits below the fault limit', () => {
		expect(describeFaults([{ reason: 'extra', path: ['a'] }], {})).toBe(
			'a: extra; this key is not declared, remove it',
		)
	})

	it('always keeps at least the first fault, at the widest line one fault can render', () => {
		const properties = Object.fromEntries(
			Array.from({ length: 40 }, (_, index) => [`${'k'.repeat(5000)}${String(index)}`, {}]),
		)
		const path = Array.from({ length: 40 }, (_, index) => `${'p'.repeat(5000)}${String(index)}`)

		const lines = describeFaults(
			[
				{ reason: 'extra', path },
				{ reason: 'extra', path: ['next'] },
			],
			{ type: 'object', properties },
		).split('\n')

		expect(lines[0]?.endsWith('extra; this key is not declared, remove it')).toBe(true)
		expect(lines.join('\n').length).toBeLessThanOrEqual(REFUSAL_TEXT_LIMIT)
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
