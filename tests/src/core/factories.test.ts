import type { ToolManagerEventMap } from '@src/core'
import { createRecorder, createRecorders } from '@orkestrel/test'
import { Tool, ToolManager, createTool, createToolManager } from '@src/core'
import { describe, expect, it } from 'vitest'
import { createToolCall } from '../../setup.js'

describe('tool factories', () => {
	it('forwards initial registry hooks for add, remove, and clear', () => {
		const added = createRecorder<ToolManagerEventMap['add']>()
		const removed = createRecorder<ToolManagerEventMap['remove']>()
		const cleared = createRecorder<ToolManagerEventMap['clear']>()
		const order = createRecorder<readonly [keyof ToolManagerEventMap]>()
		const manager = createToolManager({
			on: {
				add: (tool) => {
					added.handler(tool)
					order.handler('add')
				},
				remove: (tool) => {
					removed.handler(tool)
					order.handler('remove')
				},
				clear: (tools) => {
					cleared.handler(tools)
					order.handler('clear')
				},
			},
		})
		const tool = createTool({ name: 'echo', execute: () => 'echo' })
		const replacement = createTool({ name: 'echo', execute: () => 'replacement' })

		manager.add(tool)
		manager.add(replacement)
		manager.remove('echo')
		manager.clear()

		expect(added.calls).toEqual([[tool], [replacement]])
		expect(removed.calls).toEqual([[tool], [replacement]])
		expect(cleared.calls).toEqual([[[]]])
		expect(order.calls).toEqual([['add'], ['remove'], ['add'], ['remove'], ['clear']])
		manager.destroy()
	})

	it('forwards listener errors without preventing sibling listeners', () => {
		const error = new Error('listener failed')
		const errors = createRecorder<readonly [unknown, string]>()
		const manager = createToolManager({
			on: {
				add: () => {
					throw error
				},
			},
			error: errors.handler,
		})
		const recorders = createRecorders<ToolManagerEventMap, keyof ToolManagerEventMap>(
			manager.emitter,
			['add', 'remove', 'clear'],
		)
		const tool = createTool({ name: 'echo', execute: () => 'echo' })

		expect(() => manager.add(tool)).not.toThrow()

		expect(recorders.add.calls).toEqual([[tool]])
		expect(errors.calls).toEqual([[error, 'add']])
		expect(errors.calls[0]?.[0]).toBe(error)
		expect(manager.tool('echo')).toBe(tool)
		manager.destroy()
	})

	it('creates a working tool', () => {
		const tool = createTool({
			name: 'echo',
			execute: (args) => args.value,
		})

		expect(tool).toBeInstanceOf(Tool)
		expect(tool.execute({ value: 'hello' }, { signal: new AbortController().signal })).toBe('hello')
	})

	it('creates an empty working registry', async () => {
		const manager = createToolManager()

		expect(manager).toBeInstanceOf(ToolManager)
		expect(manager.count).toBe(0)
		manager.add(createTool({ name: 'echo', execute: (args) => args.value }))
		await expect(
			manager.execute(createToolCall('echo', { value: 'hello' }, 'factory')),
		).resolves.toEqual({ id: 'factory', name: 'echo', success: true, value: 'hello' })
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
			{ id: 'success', name: 'echo', success: true, value: 'hello' },
			{ id: 'failure', name: 'boom', success: false, error: 'factory failed' },
			{
				id: 'unknown',
				name: 'missing',
				success: false,
				error: 'tool not found: missing',
			},
		])
	})
})
