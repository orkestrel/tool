import type { ToolContext, ToolInterface, ToolManagerEventMap } from '@src/core'
import { numberShape, objectShape } from '@orkestrel/contract'
import { Tool, ToolManager } from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	createRecorder,
	createRecorders,
	requireValue,
	waitForAbort,
	waitForDelay,
} from '@orkestrel/test'
import { createToolCall } from '../../../setup.js'

describe('ToolManager registry', () => {
	it('starts empty', () => {
		const manager = new ToolManager()

		expect(manager.count).toBe(0)
		expect(manager.tool('missing')).toBeUndefined()
		expect(manager.tools()).toEqual([])
		expect(manager.definitions()).toEqual([])
	})

	it('adds one tool and returns the exact registered instance', () => {
		const tool = new Tool({ name: 'a', execute: () => 1 })
		const manager = new ToolManager()

		manager.add(tool)

		expect(manager.count).toBe(1)
		expect(manager.tool('a')).toBe(tool)
	})

	it('adds batches in insertion order and accepts an empty batch', () => {
		const manager = new ToolManager()

		manager.add([])
		manager.add([
			new Tool({ name: 'a', execute: () => 1 }),
			new Tool({ name: 'b', execute: () => 2 }),
			new Tool({ name: 'c', execute: () => 3 }),
		])

		expect(manager.count).toBe(3)
		expect(manager.tools().map((tool) => tool.name)).toEqual(['a', 'b', 'c'])
	})

	it('overwrites by name without changing insertion position', async () => {
		const manager = new ToolManager()
		manager.add([
			new Tool({ name: 'a', description: 'old', execute: () => 'old' }),
			new Tool({ name: 'b', execute: () => 'b' }),
		])

		manager.add(new Tool({ name: 'a', description: 'new', execute: () => 'new' }))

		expect(manager.count).toBe(2)
		expect(manager.tools().map((tool) => tool.name)).toEqual(['a', 'b'])
		expect(manager.tool('a')?.description).toBe('new')
		await expect(manager.execute(createToolCall('a', {}, 'overwrite'))).resolves.toEqual({
			id: 'overwrite',
			name: 'a',
			success: true,
			value: 'new',
		})
	})

	it('uses the last repeated tool in a batch while preserving its position', () => {
		const manager = new ToolManager()
		manager.add([
			new Tool({ name: 'a', description: 'first', execute: () => 0 }),
			new Tool({ name: 'b', execute: () => 0 }),
		])

		manager.add([
			new Tool({ name: 'a', description: 'second', execute: () => 0 }),
			new Tool({ name: 'a', description: 'third', execute: () => 0 }),
		])

		expect(manager.tools().map((tool) => tool.name)).toEqual(['a', 'b'])
		expect(manager.tool('a')?.description).toBe('third')
	})

	it('projects plain definitions and omits absent optional keys', () => {
		const parameters = { type: 'object', properties: { a: { type: 'number' } } }
		const manager = new ToolManager()
		manager.add([
			new Tool({ name: 'full', description: 'Full', parameters, execute: () => 0 }),
			new Tool({ name: 'description', description: 'Description', execute: () => 0 }),
			new Tool({ name: 'parameters', parameters, execute: () => 0 }),
			new Tool({ name: 'bare', execute: () => 0 }),
		])

		const definitions = manager.definitions()

		expect(definitions).toEqual([
			{ name: 'full', description: 'Full', parameters },
			{ name: 'description', description: 'Description' },
			{ name: 'parameters', parameters },
			{ name: 'bare' },
		])
		expect('execute' in requireValue(definitions[0])).toBe(false)
		expect('parameters' in requireValue(definitions[1])).toBe(false)
		expect('description' in requireValue(definitions[2])).toBe(false)
		expect('description' in requireValue(definitions[3])).toBe(false)
		expect(requireValue(definitions[0]).parameters).toBe(parameters)
	})

	it('advertises summary in place of the full description', () => {
		const manager = new ToolManager()
		manager.add([
			new Tool({
				name: 'summary',
				description: 'A detailed explanation.',
				summary: 'A concise explanation.',
				execute: () => 0,
			}),
			new Tool({ name: 'full', description: 'Full only.', execute: () => 0 }),
			new Tool({ name: 'bare', execute: () => 0 }),
		])

		expect(manager.definitions()).toEqual([
			{ name: 'summary', description: 'A concise explanation.' },
			{ name: 'full', description: 'Full only.' },
			{ name: 'bare' },
		])
		expect(manager.tool('summary')?.description).toBe('A detailed explanation.')
	})
})

describe('ToolManager events', () => {
	it('emits add with the exact tool after registration', () => {
		const manager = new ToolManager()
		const recorders = createRecorders<ToolManagerEventMap, keyof ToolManagerEventMap>(
			manager.emitter,
			['add', 'remove', 'clear'],
		)
		const registered = createRecorder<readonly [boolean]>()
		manager.emitter.on('add', (tool) => registered.handler(manager.tool(tool.name) === tool))
		const tool = new Tool({ name: 'echo', execute: () => 'echo' })

		manager.add(tool)

		expect(recorders.add.calls).toEqual([[tool]])
		expect(recorders.add.calls[0]?.[0]).toBe(tool)
		expect(registered.calls).toEqual([[true]])
		expect(recorders.remove.calls).toEqual([])
		expect(recorders.clear.calls).toEqual([])
	})

	it('emits add for each batch tool in array order and nothing for an empty batch', () => {
		const manager = new ToolManager()
		const recorders = createRecorders<ToolManagerEventMap, keyof ToolManagerEventMap>(
			manager.emitter,
			['add', 'remove', 'clear'],
		)
		const first = new Tool({ name: 'first', execute: () => 1 })
		const second = new Tool({ name: 'second', execute: () => 2 })
		const registered = createRecorder<readonly [boolean]>()
		manager.emitter.on('add', (tool) => registered.handler(manager.tool(tool.name) === tool))

		manager.add([])
		expect(recorders.add.calls).toEqual([])
		manager.add([second, first])

		expect(recorders.add.calls).toEqual([[second], [first]])
		expect(registered.calls).toEqual([[true], [true]])
		expect(manager.tools()).toEqual([second, first])
		expect(recorders.remove.calls).toEqual([])
		expect(recorders.clear.calls).toEqual([])
	})

	it('emits remove before add for replacements while preserving registration position', () => {
		const manager = new ToolManager()
		const previous = new Tool({ name: 'echo', execute: () => 'previous' })
		const sibling = new Tool({ name: 'sibling', execute: () => 'sibling' })
		const replacement = new Tool({ name: 'echo', execute: () => 'replacement' })
		manager.add([previous, sibling])
		const recorders = createRecorders<ToolManagerEventMap, keyof ToolManagerEventMap>(
			manager.emitter,
			['add', 'remove', 'clear'],
		)
		const order = createRecorder<readonly [string, ToolInterface]>()
		const installed = createRecorder<readonly [ToolInterface | undefined]>()
		manager.emitter.on('remove', (tool) => installed.handler(manager.tool(tool.name)))
		manager.emitter.on('remove', (tool) => order.handler('remove', tool))
		manager.emitter.on('add', (tool) => order.handler('add', tool))

		manager.add(replacement)
		manager.add([previous, replacement])

		expect(order.calls).toEqual([
			['remove', previous],
			['add', replacement],
			['remove', replacement],
			['add', previous],
			['remove', previous],
			['add', replacement],
		])
		expect(recorders.remove.calls).toEqual([[previous], [replacement], [previous]])
		expect(recorders.add.calls).toEqual([[replacement], [previous], [replacement]])
		expect(recorders.remove.calls[0]?.[0]).toBe(previous)
		expect(installed.calls[0]?.[0]).toBe(replacement)
		expect(installed.calls[1]?.[0]).toBe(previous)
		expect(installed.calls[2]?.[0]).toBe(replacement)
		expect(recorders.add.calls[0]?.[0]).toBe(replacement)
		expect(recorders.clear.calls).toEqual([])
		expect(manager.tool('echo')).toBe(replacement)
		expect(manager.tools()).toEqual([replacement, sibling])
	})

	it('emits remove after deleting the exact tool and stays silent for a missing name', () => {
		const manager = new ToolManager()
		const tool = new Tool({ name: 'echo', execute: () => 'echo' })
		manager.add(tool)
		const recorders = createRecorders<ToolManagerEventMap, keyof ToolManagerEventMap>(
			manager.emitter,
			['add', 'remove', 'clear'],
		)
		const remaining = createRecorder<readonly [ToolInterface | undefined]>()
		manager.emitter.on('remove', (removed) => remaining.handler(manager.tool(removed.name)))

		expect(manager.remove('echo')).toBe(true)
		expect(manager.remove('echo')).toBe(false)
		expect(recorders.remove.calls).toEqual([[tool]])
		expect(recorders.remove.calls[0]?.[0]).toBe(tool)
		expect(remaining.calls).toEqual([[undefined]])
		expect(recorders.add.calls).toEqual([])
		expect(recorders.clear.calls).toEqual([])
	})

	it('emits batch removals in requested order and reports missing or repeated names', () => {
		const manager = new ToolManager()
		const first = new Tool({ name: 'first', execute: () => 1 })
		const second = new Tool({ name: 'second', execute: () => 2 })
		manager.add([first, second])
		const recorders = createRecorders<ToolManagerEventMap, keyof ToolManagerEventMap>(
			manager.emitter,
			['add', 'remove', 'clear'],
		)
		const remaining = createRecorder<readonly [ToolInterface | undefined]>()
		manager.emitter.on('remove', (tool) => remaining.handler(manager.tool(tool.name)))

		expect(manager.remove(['second', 'missing', 'second', 'first'])).toBe(false)
		expect(manager.remove([])).toBe(true)
		expect(recorders.remove.calls).toEqual([[second], [first]])
		expect(remaining.calls).toEqual([[undefined], [undefined]])
		expect(recorders.add.calls).toEqual([])
		expect(recorders.clear.calls).toEqual([])
		expect(manager.tools()).toEqual([])
	})

	it('emits one clear snapshot in registration order after emptying the registry', () => {
		const manager = new ToolManager()
		const first = new Tool({ name: 'first', execute: () => 1 })
		const second = new Tool({ name: 'second', execute: () => 2 })
		manager.add([second, first])
		const recorders = createRecorders<ToolManagerEventMap, keyof ToolManagerEventMap>(
			manager.emitter,
			['add', 'remove', 'clear'],
		)
		const remaining = createRecorder<readonly [number]>()
		manager.emitter.on('clear', () => remaining.handler(manager.count))

		manager.clear()

		expect(recorders.clear.calls).toEqual([[[second, first]]])
		expect(recorders.clear.calls[0]?.[0][0]).toBe(second)
		expect(recorders.clear.calls[0]?.[0][1]).toBe(first)
		expect(remaining.calls).toEqual([[0]])
		expect(recorders.add.calls).toEqual([])
		expect(recorders.remove.calls).toEqual([])
		manager.add(first)
		expect(recorders.clear.calls).toEqual([[[second, first]]])
	})

	it('emits one empty clear event for every clear of an empty registry', () => {
		const manager = new ToolManager()
		const recorders = createRecorders<ToolManagerEventMap, keyof ToolManagerEventMap>(
			manager.emitter,
			['add', 'remove', 'clear'],
		)

		manager.clear()
		manager.clear()

		expect(recorders.clear.calls).toEqual([[[]], [[]]])
		expect(recorders.add.calls).toEqual([])
		expect(recorders.remove.calls).toEqual([])
		const first = new Tool({ name: 'first', execute: () => 1 })
		const second = new Tool({ name: 'second', execute: () => 2 })
		manager.add([second, first])
		manager.clear()
		expect(recorders.clear.calls).toEqual([[[]], [[]], [[second, first]]])
		expect(recorders.clear.calls[2]?.[0][0]).toBe(second)
		expect(recorders.clear.calls[2]?.[0][1]).toBe(first)
	})

	it('replacement reentry preserves publication consistency', () => {
		const manager = new ToolManager()
		const previous = new Tool({ name: 'echo', execute: () => 'previous' })
		const replacement = new Tool({ name: 'echo', execute: () => 'replacement' })
		manager.add(previous)
		const recorders = createRecorders<ToolManagerEventMap, keyof ToolManagerEventMap>(
			manager.emitter,
			['add', 'remove', 'clear'],
		)
		const registered = createRecorder<readonly [boolean]>()
		const order = createRecorder<readonly [string]>()
		manager.emitter.on('remove', () => order.handler('remove'))
		manager.emitter.once('remove', () => {
			order.handler('enter')
			manager.remove('echo')
			order.handler('resume')
		})
		manager.emitter.on('add', (tool) => registered.handler(manager.tool(tool.name) === tool))

		manager.add(replacement)

		expect(recorders.remove.calls[0]?.[0]).toBe(previous)
		expect(recorders.remove.calls[1]?.[0]).toBe(replacement)
		expect(recorders.add.calls).toEqual([])
		expect(registered.calls).toEqual([])
		expect(recorders.clear.calls).toEqual([])
		expect(manager.tools()).toEqual([])
		expect(order.calls).toEqual([['remove'], ['enter'], ['remove'], ['resume']])

		manager.add(previous)
		recorders.add.clear()
		registered.clear()
		manager.add(replacement)
		expect(recorders.add.calls[0]?.[0]).toBe(replacement)
		expect(registered.calls).toEqual([[true]])
		expect(manager.tool('echo')).toBe(replacement)
	})

	it('publishes the third instance a removal listener installs during a replacement', () => {
		const manager = new ToolManager()
		const previous = new Tool({ name: 'echo', execute: () => 'previous' })
		const replacement = new Tool({ name: 'echo', execute: () => 'replacement' })
		const third = new Tool({ name: 'echo', execute: () => 'third' })
		manager.add(previous)
		const recorders = createRecorders<ToolManagerEventMap, keyof ToolManagerEventMap>(
			manager.emitter,
			['add', 'remove'],
		)
		manager.emitter.once('remove', () => manager.add(third))

		manager.add(replacement)

		expect(recorders.remove.calls[0]?.[0]).toBe(previous)
		expect(recorders.remove.calls[1]?.[0]).toBe(replacement)
		expect(recorders.remove.calls.length).toBe(2)
		expect(recorders.add.calls).toEqual([[third]])
		expect(manager.tool('echo')).toBe(third)
	})

	it('destroy finishes with an empty registry', () => {
		const manager = new ToolManager()
		const tool = new Tool({ name: 'echo', execute: () => 'echo' })
		manager.add(tool)
		const recorders = createRecorders<ToolManagerEventMap, keyof ToolManagerEventMap>(
			manager.emitter,
			['add', 'remove', 'clear'],
		)
		manager.emitter.once('clear', () => manager.add(tool))

		manager.destroy()

		expect(recorders.clear.calls).toEqual([[[tool]]])
		expect(recorders.add.calls[0]?.[0]).toBe(tool)
		expect(recorders.remove.calls).toEqual([])
		expect(manager.emitter.destroyed).toBe(true)
		expect(manager.count).toBe(0)
		expect(manager.tools()).toEqual([])
	})

	it('a listener destroying the registry mid-emit does not stop its siblings', () => {
		const manager = new ToolManager()
		const tool = new Tool({ name: 'echo', execute: () => 'echo' })
		const readings = createRecorder<readonly [boolean]>()
		manager.emitter.on('add', () => manager.destroy())
		manager.emitter.on('add', () => readings.handler(manager.emitter.destroyed))
		const recorders = createRecorders<ToolManagerEventMap, keyof ToolManagerEventMap>(
			manager.emitter,
			['add', 'remove', 'clear'],
		)

		manager.add(tool)

		expect(readings.calls).toEqual([[true]])
		expect(recorders.add.calls[0]?.[0]).toBe(tool)
		expect(recorders.clear.calls[0]?.[0][0]).toBe(tool)
		expect(recorders.remove.calls).toEqual([])
		expect(manager.count).toBe(0)
	})

	it('destroys the emitter after clearing the registry and publishing the removed tools', () => {
		const manager = new ToolManager()
		const tool = new Tool({ name: 'echo', execute: () => 'echo' })
		manager.add(tool)
		const recorders = createRecorders<ToolManagerEventMap, keyof ToolManagerEventMap>(
			manager.emitter,
			['add', 'remove', 'clear'],
		)
		const clearing = createRecorder<readonly [number, boolean]>()
		manager.emitter.on('clear', () => clearing.handler(manager.count, manager.emitter.destroyed))

		manager.destroy()

		expect(recorders.clear.calls).toEqual([[[tool]]])
		expect(clearing.calls).toEqual([[0, false]])
		expect(manager.tools()).toEqual([])
		expect(manager.emitter.destroyed).toBe(true)
		expect(manager.emitter.count()).toBe(0)
		expect(recorders.add.calls).toEqual([])
		expect(recorders.remove.calls).toEqual([])
		manager.destroy()
		expect(recorders.clear.calls).toEqual([[[tool]]])
	})

	it('publishes nothing for a later add after destroy while updating the registry', () => {
		const manager = new ToolManager()
		const recorders = createRecorders<ToolManagerEventMap, keyof ToolManagerEventMap>(
			manager.emitter,
			['add', 'remove', 'clear'],
		)
		const tool = new Tool({ name: 'echo', execute: () => 'echo' })
		manager.add(tool)
		expect(recorders.add.calls).toEqual([[tool]])
		manager.destroy()
		recorders.add.clear()
		recorders.clear.clear()
		const later = createRecorder<readonly [ToolInterface]>()
		manager.emitter.on('add', later.handler)

		manager.add(tool)

		expect(manager.tool('echo')).toBe(tool)
		expect(recorders.add.calls).toEqual([])
		expect(recorders.remove.calls).toEqual([])
		expect(recorders.clear.calls).toEqual([])
		expect(later.calls).toEqual([])
		manager.destroy()
		expect(manager.count).toBe(0)
		expect(recorders.clear.calls).toEqual([])
	})

	it('executes single and batch calls without publishing registry events', async () => {
		const manager = new ToolManager()
		const recorders = createRecorders<ToolManagerEventMap, keyof ToolManagerEventMap>(
			manager.emitter,
			['add', 'remove', 'clear'],
		)
		const tool = new Tool({ name: 'echo', execute: (args) => args.value })
		manager.add(tool)
		expect(recorders.add.calls).toEqual([[tool]])
		recorders.add.clear()

		await expect(manager.execute(createToolCall('echo', { value: 'single' }))).resolves.toEqual({
			id: 'call',
			name: 'echo',
			success: true,
			value: 'single',
		})
		await expect(
			manager.execute([createToolCall('echo', { value: 'batch' }), createToolCall('missing')]),
		).resolves.toEqual([
			{ id: 'call', name: 'echo', success: true, value: 'batch' },
			{ id: 'call', name: 'missing', success: false, error: 'tool not found: missing' },
		])
		expect(recorders.add.calls).toEqual([])
		expect(recorders.remove.calls).toEqual([])
		expect(recorders.clear.calls).toEqual([])
	})
})

describe('ToolManager execution', () => {
	it('resolves synchronous and asynchronous handlers', async () => {
		const manager = new ToolManager()
		manager.add([
			new Tool({
				name: 'add',
				execute: (args) => Number(args.a) + Number(args.b),
			}),
			new Tool({
				name: 'echo',
				execute: async (args) => {
					await Promise.resolve()
					return args.text
				},
			}),
		])

		await expect(manager.execute(createToolCall('add', { a: 2, b: 5 }, 'sync'))).resolves.toEqual({
			id: 'sync',
			name: 'add',
			success: true,
			value: 7,
		})
		await expect(manager.execute(createToolCall('echo', { text: 'ok' }, 'async'))).resolves.toEqual(
			{ id: 'async', name: 'echo', success: true, value: 'ok' },
		)
	})

	it('forwards the exact arguments record, including an empty record', async () => {
		const seen: Array<Readonly<Record<string, unknown>>> = []
		const manager = new ToolManager()
		manager.add(
			new Tool({
				name: 'capture',
				execute: (args) => {
					seen.push(args)
					return 'ok'
				},
			}),
		)
		const args = { nested: { values: [1, 2, 3] } }
		const empty = {}

		await manager.execute(createToolCall('capture', args, 'args'))
		await manager.execute(createToolCall('capture', empty, 'empty'))

		expect(seen).toEqual([args, empty])
		expect(seen[0]).toBe(args)
		expect(seen[1]).toBe(empty)
	})

	it('mints a non-aborted signal when execution context is omitted', async () => {
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const manager = new ToolManager()
		manager.add(new Tool({ name: 'capture', execute: recorder.handler }))

		await manager.execute(createToolCall('capture'))
		await manager.execute(createToolCall('capture'))

		const first = requireValue(recorder.calls[0]?.[1])
		const second = requireValue(recorder.calls[1]?.[1])
		expect(first.signal).toBeInstanceOf(AbortSignal)
		expect(first.signal.aborted).toBe(false)
		expect(first.caller).toBeUndefined()
		expect(second.signal).not.toBe(first.signal)
	})

	it('forwards a supplied context and caller identity unchanged', async () => {
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const manager = new ToolManager()
		manager.add(new Tool({ name: 'capture', execute: recorder.handler }))
		const context: ToolContext = {
			signal: new AbortController().signal,
			caller: { subject: 'reader' },
		}

		await manager.execute(createToolCall('capture'), context)

		expect(recorder.calls[0]?.[1]).toBe(context)
		expect(recorder.calls[0]?.[1].caller).toBe(context.caller)
	})

	it('delivers an abort to a handler during execution', async () => {
		const controller = new AbortController()
		const manager = new ToolManager()
		const entered = createRecorder<[]>()
		manager.add(
			new Tool({
				name: 'wait',
				execute: async (_args, context) => {
					entered.handler()
					await waitForAbort(context.signal)
					return context.signal.reason
				},
			}),
		)

		const pending = manager.execute(createToolCall('wait'), { signal: controller.signal })
		expect(entered.count).toBe(1)
		await waitForDelay(10)
		controller.abort('stopped waiting')

		await expect(pending).resolves.toEqual({
			id: 'call',
			name: 'wait',
			success: true,
			value: 'stopped waiting',
		})
	})

	it('refuses an already-aborted signal without entering the handler', async () => {
		const controller = new AbortController()
		controller.abort('request ended')
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const manager = new ToolManager()
		manager.add(new Tool({ name: 'capture', execute: recorder.handler }))

		await expect(
			manager.execute(createToolCall('capture'), { signal: controller.signal }),
		).resolves.toEqual({ id: 'call', name: 'capture', success: false, error: 'request ended' })
		expect(recorder.count).toBe(0)
	})

	it('contains contract refusal as a failure naming the argument path and reason', async () => {
		const recorder = createRecorder<[Readonly<Record<string, unknown>>, ToolContext]>()
		const manager = new ToolManager()
		manager.add(
			new Tool({
				name: 'amount',
				contract: objectShape({ amount: numberShape() }),
				execute: recorder.handler,
			}),
		)

		await expect(manager.execute(createToolCall('amount', { amount: 'invalid' }))).resolves.toEqual(
			{
				id: 'call',
				name: 'amount',
				success: false,
				error: 'amount: type; expected number; received "invalid"',
			},
		)
		expect(recorder.count).toBe(0)
	})

	it('preserves falsy, null, and undefined success values', async () => {
		const manager = new ToolManager()
		manager.add([
			new Tool({ name: 'zero', execute: () => 0 }),
			new Tool({ name: 'empty', execute: () => '' }),
			new Tool({ name: 'false', execute: () => false }),
			new Tool({ name: 'null', execute: () => null }),
			new Tool({ name: 'void', execute: () => undefined }),
		])

		const results = await manager.execute([
			createToolCall('zero', {}, 'zero'),
			createToolCall('empty', {}, 'empty'),
			createToolCall('false', {}, 'false'),
			createToolCall('null', {}, 'null'),
			createToolCall('void', {}, 'void'),
		])

		expect(results).toEqual([
			{ id: 'zero', name: 'zero', success: true, value: 0 },
			{ id: 'empty', name: 'empty', success: true, value: '' },
			{ id: 'false', name: 'false', success: true, value: false },
			{ id: 'null', name: 'null', success: true, value: null },
			{ id: 'void', name: 'void', success: true, value: undefined },
		])
		const result = requireValue(results[4])
		expect(result.success).toBe(true)
		const value = result.success ? result.value : 'unexpected failure'
		expect('value' in result).toBe(true)
		expect(value).toBeUndefined()
	})

	it('isolates synchronous throws and asynchronous rejections', async () => {
		const manager = new ToolManager()
		manager.add([
			new Tool({
				name: 'throw',
				execute: () => {
					throw new Error('handler failed')
				},
			}),
			new Tool({
				name: 'reject',
				execute: () => Promise.reject(new Error('async failed')),
			}),
		])

		const results = await manager.execute([
			createToolCall('throw', {}, 'throw'),
			createToolCall('reject', {}, 'reject'),
		])

		expect(results).toEqual([
			{ id: 'throw', name: 'throw', success: false, error: 'handler failed' },
			{ id: 'reject', name: 'reject', success: false, error: 'async failed' },
		])
		const result = requireValue(results[0])
		expect(result.success).toBe(false)
		const error = result.success ? undefined : result.error
		expect(error).toBe('handler failed')
	})

	it('uses messages from Error subclasses', async () => {
		const manager = new ToolManager()
		manager.add(
			new Tool({
				name: 'type',
				execute: () => {
					throw new TypeError('wrong value')
				},
			}),
		)

		await expect(manager.execute(createToolCall('type', {}, 'type'))).resolves.toEqual({
			id: 'type',
			name: 'type',
			success: false,
			error: 'wrong value',
		})
	})

	it('stringifies non-Error throws', async () => {
		const manager = new ToolManager()
		manager.add([
			new Tool({
				name: 'string',
				execute: () => {
					throw 'text'
				},
			}),
			new Tool({
				name: 'number',
				execute: () => {
					throw 42
				},
			}),
			new Tool({
				name: 'object',
				execute: () => {
					throw { message: 'not an Error' }
				},
			}),
			new Tool({
				name: 'null',
				execute: () => {
					throw null
				},
			}),
			new Tool({
				name: 'undefined',
				execute: () => {
					throw undefined
				},
			}),
		])

		const results = await manager.execute([
			createToolCall('string', {}, 'string'),
			createToolCall('number', {}, 'number'),
			createToolCall('object', {}, 'object'),
			createToolCall('null', {}, 'null'),
			createToolCall('undefined', {}, 'undefined'),
		])

		expect(results).toEqual([
			{ id: 'string', name: 'string', success: false, error: 'text' },
			{ id: 'number', name: 'number', success: false, error: '42' },
			{ id: 'object', name: 'object', success: false, error: '[object Object]' },
			{ id: 'null', name: 'null', success: false, error: 'null' },
			{ id: 'undefined', name: 'undefined', success: false, error: 'undefined' },
		])
	})

	it('uses a fixed fallback when a thrown object cannot be stringified', async () => {
		const reason = {
			toString: () => {
				throw new Error('blocked string conversion')
			},
		}
		const manager = new ToolManager()
		manager.add(
			new Tool({
				name: 'hostile',
				execute: () => {
					throw reason
				},
			}),
		)

		await expect(manager.execute(createToolCall('hostile', {}, 'hostile'))).resolves.toEqual({
			id: 'hostile',
			name: 'hostile',
			success: false,
			error: 'Unknown thrown value',
		})
	})

	it('uses a fixed fallback when an Error subclass message getter throws', async () => {
		const reason = new (class extends Error {})('hidden')
		Object.defineProperty(reason, 'message', {
			get: () => {
				throw new Error('blocked message')
			},
		})
		const manager = new ToolManager()
		manager.add(
			new Tool({
				name: 'hostile',
				execute: () => {
					throw reason
				},
			}),
		)

		await expect(manager.execute(createToolCall('hostile', {}, 'hostile'))).resolves.toEqual({
			id: 'hostile',
			name: 'hostile',
			success: false,
			error: 'Unknown thrown value',
		})
	})

	it('uses a fixed fallback for a thrown null-prototype object', async () => {
		const reason: unknown = Object.create(null)
		const manager = new ToolManager()
		manager.add(
			new Tool({
				name: 'hostile',
				execute: () => {
					throw reason
				},
			}),
		)

		await expect(manager.execute(createToolCall('hostile', {}, 'hostile'))).resolves.toEqual({
			id: 'hostile',
			name: 'hostile',
			success: false,
			error: 'Unknown thrown value',
		})
	})

	it('rejects when the call id accessor throws, the documented limit on always resolving', async () => {
		// The envelope members are read to correlate the result, so a call whose own `id`
		// getter throws leaves no result to build and `execute` rejects instead. This is the
		// qualification `ToolResult` and the guide carry; it is not a handler failure.
		const manager = new ToolManager()
		manager.add(new Tool({ name: 'add', execute: (args) => Number(args.a) + Number(args.b) }))
		const call = createToolCall('add', { a: 1, b: 1 }, 'hostile')
		Object.defineProperty(call, 'id', {
			get: () => {
				throw new Error('blocked id read')
			},
		})

		await expect(manager.execute(call)).rejects.toThrow('blocked id read')
	})

	it('resolves unknown names to not-found errors without a value', async () => {
		const manager = new ToolManager()

		const result = await manager.execute(createToolCall('ghost', {}, 'missing'))

		expect(result).toEqual({
			id: 'missing',
			name: 'ghost',
			success: false,
			error: 'tool not found: ghost',
		})
		expect(result.success).toBe(false)
		const error = result.success ? undefined : result.error
		expect(error).toBe('tool not found: ghost')
	})

	it('narrows success and failure results by their discriminant', async () => {
		const manager = new ToolManager()
		manager.add(new Tool({ name: 'void', execute: () => undefined }))

		const results = await manager.execute([
			createToolCall('void', {}, 'success'),
			createToolCall('missing', {}, 'failure'),
		])
		expect(requireValue(results[0]).success).toBe(true)
		expect(requireValue(results[1]).success).toBe(false)
		const outcomes = results.map((result) => {
			if (result.success) return result.value
			return result.error
		})

		expect(outcomes).toEqual([undefined, 'tool not found: missing'])
	})
})

describe('ToolManager batch execution', () => {
	it('shares one context across a batch and preserves order beside a thrown handler', async () => {
		const recorder = createRecorder<[ToolContext]>()
		const manager = new ToolManager()
		manager.add(
			new Tool({
				name: 'batch',
				execute: async (args, context) => {
					recorder.handler(context)
					if (args.value === 'fail') throw new Error('batch failure')
					if (args.value === 'slow') await waitForDelay(10)
					return args.value
				},
			}),
		)
		const context: ToolContext = { signal: new AbortController().signal, caller: 'reader' }
		const calls = [
			createToolCall('batch', { value: 'slow' }, 'slow'),
			createToolCall('batch', { value: 'fail' }, 'fail'),
			createToolCall('batch', { value: 'fast' }, 'fast'),
		]

		const supplied = await manager.execute(calls, context)
		const minted = await manager.execute(calls)

		expect(supplied).toEqual([
			{ id: 'slow', name: 'batch', success: true, value: 'slow' },
			{ id: 'fail', name: 'batch', success: false, error: 'batch failure' },
			{ id: 'fast', name: 'batch', success: true, value: 'fast' },
		])
		expect(minted).toEqual(supplied)
		expect(recorder.calls.slice(0, 3).every(([received]) => received === context)).toBe(true)
		const shared = requireValue(recorder.calls[3]?.[0])
		expect(shared.signal.aborted).toBe(false)
		expect(recorder.calls.slice(3).every(([received]) => received === shared)).toBe(true)
	})

	it('refuses later batch handlers after a synchronous abort inside dispatch', async () => {
		const controller = new AbortController()
		const entered = createRecorder<[]>()
		const manager = new ToolManager()
		manager.add([
			new Tool({
				name: 'abort',
				execute: () => {
					controller.abort('batch ended')
					return 'done'
				},
			}),
			new Tool({ name: 'later', execute: entered.handler }),
		])

		await expect(
			manager.execute([createToolCall('abort'), createToolCall('later')], {
				signal: controller.signal,
			}),
		).resolves.toEqual([
			{ id: 'call', name: 'abort', success: true, value: 'done' },
			{ id: 'call', name: 'later', success: false, error: 'batch ended' },
		])
		expect(entered.count).toBe(0)
	})

	it('enters and succeeds in a later sibling when an earlier handler aborts asynchronously', async () => {
		const controller = new AbortController()
		const entered = createRecorder<[]>()
		const manager = new ToolManager()
		manager.add([
			new Tool({
				name: 'abort',
				execute: async () => {
					await waitForDelay(1)
					controller.abort('batch ended')
					return 'done'
				},
			}),
			new Tool({
				name: 'later',
				execute: () => {
					entered.handler()
					return 'ran'
				},
			}),
		])

		const pending = manager.execute([createToolCall('abort'), createToolCall('later')], {
			signal: controller.signal,
		})
		expect(entered.count).toBe(1)
		expect(controller.signal.aborted).toBe(false)
		await expect(pending).resolves.toEqual([
			{ id: 'call', name: 'abort', success: true, value: 'done' },
			{ id: 'call', name: 'later', success: true, value: 'ran' },
		])
		expect(controller.signal.aborted).toBe(true)
	})

	it('lets a sibling observe the signal after an asynchronous batch abort', async () => {
		const controller = new AbortController()
		const entered = createRecorder<[boolean]>()
		const manager = new ToolManager()
		manager.add([
			new Tool({
				name: 'abort',
				execute: async () => {
					await waitForDelay(1)
					controller.abort('batch ended')
					return 'done'
				},
			}),
			new Tool({
				name: 'observe',
				execute: async (_args, context) => {
					entered.handler(context.signal.aborted)
					await waitForAbort(context.signal)
					return context.signal.aborted
				},
			}),
		])

		const pending = manager.execute([createToolCall('abort'), createToolCall('observe')], {
			signal: controller.signal,
		})
		expect(entered.calls).toEqual([[false]])
		await expect(pending).resolves.toEqual([
			{ id: 'call', name: 'abort', success: true, value: 'done' },
			{ id: 'call', name: 'observe', success: true, value: true },
		])
	})

	it('correlates mixed results by id in input order', async () => {
		const manager = new ToolManager()
		manager.add([
			new Tool({
				name: 'add',
				execute: (args) => Number(args.a) + Number(args.b),
			}),
			new Tool({
				name: 'boom',
				execute: () => {
					throw new Error('nope')
				},
			}),
		])

		const results = await manager.execute([
			createToolCall('add', { a: 1, b: 1 }, 'a'),
			createToolCall('boom', {}, 'b'),
			createToolCall('ghost', {}, 'c'),
		])

		expect(results).toEqual([
			{ id: 'a', name: 'add', success: true, value: 2 },
			{ id: 'b', name: 'boom', success: false, error: 'nope' },
			{ id: 'c', name: 'ghost', success: false, error: 'tool not found: ghost' },
		])
		const success = requireValue(results[0])
		const thrown = requireValue(results[1])
		const missing = requireValue(results[2])
		expect(success.success).toBe(true)
		const value = success.success ? success.value : undefined
		expect(value).toBe(2)
		expect(thrown.success).toBe(false)
		const thrownError = thrown.success ? undefined : thrown.error
		expect(thrownError).toBe('nope')
		expect(missing.success).toBe(false)
		const missingError = missing.success ? undefined : missing.error
		expect(missingError).toBe('tool not found: ghost')
	})

	it('fully resolves a success beside a hostile throw', async () => {
		const reason = {
			toString: () => {
				throw new Error('blocked string conversion')
			},
		}
		const manager = new ToolManager()
		manager.add([
			new Tool({ name: 'ok', execute: () => 'done' }),
			new Tool({
				name: 'hostile',
				execute: () => {
					throw reason
				},
			}),
		])

		await expect(
			manager.execute([
				createToolCall('hostile', {}, 'failed'),
				createToolCall('ok', {}, 'succeeded'),
			]),
		).resolves.toEqual([
			{
				id: 'failed',
				name: 'hostile',
				success: false,
				error: 'Unknown thrown value',
			},
			{ id: 'succeeded', name: 'ok', success: true, value: 'done' },
		])
	})

	it('preserves input order when handlers settle out of order', async () => {
		const settled: string[] = []
		const manager = new ToolManager()
		manager.add([
			new Tool({
				name: 'slow',
				execute: async () => {
					await waitForDelay(25)
					settled.push('slow')
					return 'slow'
				},
			}),
			new Tool({
				name: 'fast',
				execute: async () => {
					await Promise.resolve()
					settled.push('fast')
					return 'fast'
				},
			}),
		])

		const results = await manager.execute([
			createToolCall('slow', {}, 'slow'),
			createToolCall('fast', {}, 'fast'),
		])

		expect(settled).toEqual(['fast', 'slow'])
		expect(results).toEqual([
			{ id: 'slow', name: 'slow', success: true, value: 'slow' },
			{ id: 'fast', name: 'fast', success: true, value: 'fast' },
		])
	})

	it('keeps duplicate ids as distinct positional calls', async () => {
		const manager = new ToolManager()
		manager.add(new Tool({ name: 'echo', execute: (args) => args.value }))

		const results = await manager.execute([
			createToolCall('echo', { value: 'first' }, 'same'),
			createToolCall('echo', { value: 'second' }, 'same'),
		])

		expect(results).toEqual([
			{ id: 'same', name: 'echo', success: true, value: 'first' },
			{ id: 'same', name: 'echo', success: true, value: 'second' },
		])
	})

	it('resolves empty and large batches', async () => {
		const manager = new ToolManager()
		manager.add(
			new Tool({
				name: 'square',
				execute: (args) => Number(args.value) * Number(args.value),
			}),
		)
		const calls = Array.from({ length: 200 }, (_unused, index) =>
			createToolCall('square', { value: index }, `id-${String(index)}`),
		)

		await expect(manager.execute([])).resolves.toEqual([])
		const results = await manager.execute(calls)
		expect(results).toHaveLength(200)
		expect(results.every((result, index) => result.id === `id-${String(index)}`)).toBe(true)
		expect(results[7]).toEqual({ id: 'id-7', name: 'square', success: true, value: 49 })
		expect(results[199]).toEqual({
			id: 'id-199',
			name: 'square',
			success: true,
			value: 39_601,
		})
	})
})

describe('ToolManager removal', () => {
	it('removes one tool and reports whether it was present', () => {
		const manager = new ToolManager()
		manager.add(new Tool({ name: 'a', execute: () => 0 }))

		expect(manager.remove('a')).toBe(true)
		expect(manager.remove('a')).toBe(false)
		expect(manager.count).toBe(0)
	})

	it('removes a batch and reports true only when every named tool was present', () => {
		const manager = new ToolManager()
		manager.add([
			new Tool({ name: 'a', execute: () => 0 }),
			new Tool({ name: 'b', execute: () => 0 }),
			new Tool({ name: 'c', execute: () => 0 }),
		])

		expect(manager.remove(['a', 'missing'])).toBe(false)
		expect(manager.remove(['absent'])).toBe(false)
		expect(manager.remove(['b', 'c'])).toBe(true)
		expect(manager.remove([])).toBe(true)
		expect(manager.tools().map((tool) => tool.name)).toEqual([])
		expect(manager.definitions().map((definition) => definition.name)).toEqual([])
	})

	it('executes a removed tool as not found and re-adds it at the end', async () => {
		const manager = new ToolManager()
		manager.add([
			new Tool({ name: 'a', execute: () => 'old' }),
			new Tool({ name: 'b', execute: () => 'b' }),
		])

		manager.remove('a')
		await expect(manager.execute(createToolCall('a', {}, 'removed'))).resolves.toEqual({
			id: 'removed',
			name: 'a',
			success: false,
			error: 'tool not found: a',
		})
		manager.add(new Tool({ name: 'a', execute: () => 'new' }))

		expect(manager.tools().map((tool) => tool.name)).toEqual(['b', 'a'])
		await expect(manager.execute(createToolCall('a', {}, 'added'))).resolves.toEqual({
			id: 'added',
			name: 'a',
			success: true,
			value: 'new',
		})
	})

	it('clears every tool and leaves repeated clears empty', async () => {
		const manager = new ToolManager()
		manager.add([
			new Tool({ name: 'a', execute: () => 0 }),
			new Tool({ name: 'b', execute: () => 0 }),
		])

		manager.clear()
		manager.clear()

		expect(manager.count).toBe(0)
		expect(manager.tools()).toEqual([])
		expect(manager.definitions()).toEqual([])
		await expect(
			manager.execute([createToolCall('a', {}, 'a'), createToolCall('b', {}, 'b')]),
		).resolves.toEqual([
			{ id: 'a', name: 'a', success: false, error: 'tool not found: a' },
			{ id: 'b', name: 'b', success: false, error: 'tool not found: b' },
		])
	})
})
