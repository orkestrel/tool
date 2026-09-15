import { Tool, toolToDefinition } from '@src/core'
import { describe, expect, it } from 'vitest'

describe('toolToDefinition', () => {
	it('projects the name alone when nothing else was authored', () => {
		const tool = new Tool({ name: 'echo', execute: (args) => args.value })

		const definition = toolToDefinition(tool)

		expect(definition).toEqual({ name: 'echo' })
		expect(Object.keys(definition)).toEqual(['name'])
	})

	it('advertises the summary in place of the full description', () => {
		const tool = new Tool({
			name: 'add',
			description: 'Add two numeric values and return their sum.',
			summary: 'Add two numbers.',
			execute: () => 0,
		})

		expect(toolToDefinition(tool)).toEqual({ name: 'add', description: 'Add two numbers.' })
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
			execute: (args) => args.value,
		})

		const definition = toolToDefinition(tool)

		expect(definition).toEqual({
			name: 'echo',
			title: 'Echo',
			description: 'Echo a value',
			annotations,
		})
		expect(definition.annotations).toBe(annotations)
		expect(Object.keys(definition)).toEqual(['name', 'title', 'description', 'annotations'])
		expect(definition).not.toHaveProperty('summary')
		expect(definition).not.toHaveProperty('signal')
		expect(definition).not.toHaveProperty('caller')
	})

	it('projects a fresh object on every call', () => {
		const tool = new Tool({ name: 'echo', execute: (args) => args.value })

		expect(toolToDefinition(tool)).not.toBe(toolToDefinition(tool))
	})
})
