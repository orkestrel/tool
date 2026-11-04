import type { AuditFault } from '@orkestrel/contract'
import {
	FAULT_LIMIT,
	createContract,
	numberShape,
	objectShape,
	stringShape,
	unionShape,
} from '@orkestrel/contract'
import {
	CLOSED_PARAMETERS,
	Tool,
	buildCallRefusal,
	describeFaults,
	scanFaults,
	toolToDefinition,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { MALFORMED_CALLS, OPEN_ARGUMENTS } from '../../setup.js'

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

		expect(describeFaults(faults).split('\n')).toEqual([
			'profile.age: type; expected number; received "invalid"',
			'name: missing; expected string',
			'amount: constraint; expected number; received 0; constraint min; limit 1',
			'choice: variant; variants 2',
			': oneOf; matched 2',
			'zzz: extra; this key is not declared, remove it',
		])
	})

	it('encodes a key that is not a plain identifier and caps its length', () => {
		const long = 'x'.repeat(5000)

		const text = describeFaults([
			{ reason: 'extra', path: ['line\nbreak'] },
			{ reason: 'extra', path: [long] },
			{ reason: 'extra', path: ['ok_key-1', '0'] },
		])
		const lines = text.split('\n')

		expect(lines).toHaveLength(3)
		expect(lines[0]).toBe('"line\\nbreak": extra; this key is not declared, remove it')
		expect(lines[1]?.length).toBeLessThan(200)
		expect(lines[2]).toBe('ok_key-1.0: extra; this key is not declared, remove it')
	})

	it('says that a report at the fault limit is cut, and what to do', () => {
		const faults = Array.from({ length: FAULT_LIMIT }, (_, index): AuditFault => ({
			reason: 'extra',
			path: [`key${String(index)}`],
		}))

		const lines = describeFaults(faults).split('\n')

		expect(lines).toHaveLength(FAULT_LIMIT + 1)
		expect(lines.at(-1)).toBe(
			`the report stops at ${String(FAULT_LIMIT)} faults; correct these and call again`,
		)
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
