import { Tool, ToolManager, createTool, createToolManager } from '@src/core'
import { describe, expect, it } from 'vitest'
import { createToolCall } from '../../setup.js'

describe('tool factories', () => {
	it('creates a working tool', () => {
		const tool = createTool({
			name: 'echo',
			execute: (args) => args.value,
		})

		expect(tool).toBeInstanceOf(Tool)
		expect(tool.execute({ value: 'hello' })).toBe('hello')
	})

	it('creates an empty working registry', async () => {
		const manager = createToolManager()

		expect(manager).toBeInstanceOf(ToolManager)
		expect(manager.count).toBe(0)
		manager.add(createTool({ name: 'echo', execute: (args) => args.value }))
		await expect(
			manager.execute(createToolCall('echo', { value: 'hello' }, 'factory')),
		).resolves.toEqual({ id: 'factory', name: 'echo', value: 'hello' })
	})

	it('creates a registry that isolates and correlates mixed batches', async () => {
		const manager = createToolManager()
		manager.add([
			createTool({ name: 'echo', execute: (args) => args.value }),
			createTool({
				name: 'boom',
				execute: () => {
					throw new Error('factory failed')
				},
			}),
		])

		await expect(
			manager.execute([
				createToolCall('echo', { value: 'hello' }, 'success'),
				createToolCall('boom', {}, 'failure'),
				createToolCall('missing', {}, 'unknown'),
			]),
		).resolves.toEqual([
			{ id: 'success', name: 'echo', value: 'hello' },
			{ id: 'failure', name: 'boom', error: 'factory failed' },
			{ id: 'unknown', name: 'missing', error: 'tool not found: missing' },
		])
	})
})
