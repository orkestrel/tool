import { Tool, ToolManager } from '@src/core'
import { describe, expect, it } from 'vitest'
import { createToolCall, requireValue, waitForDelay } from '../../../setup.js'

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
		const seen: Readonly<Record<string, unknown>>[] = []
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

	it('removes a batch when any named tool is present', () => {
		const manager = new ToolManager()
		manager.add([
			new Tool({ name: 'a', execute: () => 0 }),
			new Tool({ name: 'b', execute: () => 0 }),
		])

		expect(manager.remove(['a', 'missing'])).toBe(true)
		expect(manager.remove(['absent'])).toBe(false)
		expect(manager.remove([])).toBe(false)
		expect(manager.tools().map((tool) => tool.name)).toEqual(['b'])
		expect(manager.definitions().map((definition) => definition.name)).toEqual(['b'])
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

	it('clears every tool and is a no-op when already empty', async () => {
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
