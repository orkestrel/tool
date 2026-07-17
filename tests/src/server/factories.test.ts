import type { TimerCancel, TimerHandler } from '@orkestrel/terminal'
import type { TerminalRoute } from '@src/server'
import { HEADER_TOKEN } from '@orkestrel/terminal'
import { createTerminalManager } from '@orkestrel/terminal'
import { createTerminalRoutes } from '@src/server'
import { describe, expect, it } from 'vitest'

// tests/src/server/factories.test.ts — mirrors src/server/factories.ts. Handlers are invoked
// DIRECTLY against a real `createTerminalManager` (`@orkestrel/terminal`) for deterministic
// coverage (AGENTS §16 — no mocks); a fake, controllable `TimerHandler` drives the SSE keepalive
// without wall-clock timing.

/** A controllable fake `TimerHandler` — records armed `(callback, ms)` pairs and lets a test fire one on demand. */
function createFakeTimer(): {
	readonly timer: TimerHandler
	fire: (index: number) => void
	readonly armed: number
} {
	const armed: Array<{ callback: () => void; cancelled: boolean }> = []
	const timer: TimerHandler = (callback, _ms) => {
		const entry = { callback, cancelled: false }
		armed.push(entry)
		const cancel: TimerCancel = () => {
			entry.cancelled = true
		}
		return cancel
	}
	return {
		timer,
		fire(index: number): void {
			const entry = armed[index]
			if (entry !== undefined && !entry.cancelled) entry.callback()
		},
		get armed() {
			return armed.length
		},
	}
}

function findRoute(
	routes: readonly TerminalRoute[],
	method: TerminalRoute['method'],
): TerminalRoute {
	const route = routes.find((r) => r.method === method)
	if (route === undefined) throw new Error(`no ${method} route`)
	return route
}

/** Read every chunk currently buffered on an SSE `Response`'s body, decoded to text. */
async function readAvailable(response: Response): Promise<string> {
	const reader = response.body?.getReader()
	if (reader === undefined) return ''
	const decoder = new TextDecoder()
	let text = ''
	const timeout = new Promise<{ done: true; value: undefined }>((resolve) =>
		setTimeout(() => resolve({ done: true, value: undefined }), 20),
	)
	while (true) {
		const result = await Promise.race([reader.read(), timeout])
		if (result.done) break
		text += decoder.decode(result.value, { stream: true })
	}
	reader.releaseLock()
	return text
}

describe('createTerminalRoutes', () => {
	it('returns exactly two routes, GET and POST, on the same path', () => {
		const manager = createTerminalManager()
		const routes = createTerminalRoutes(manager)
		expect(routes).toHaveLength(2)
		expect(routes.map((r) => r.method).sort()).toEqual(['GET', 'POST'])
		expect(new Set(routes.map((r) => r.path)).size).toBe(1)
	})

	it('GET 404s on an unknown endpoint name', async () => {
		const manager = createTerminalManager()
		const routes = createTerminalRoutes(manager)
		const get = findRoute(routes, 'GET')
		const response = await get.handler(new Request('http://x/terminals/ghost'), {
			params: { name: 'ghost' },
		})
		expect(response.status).toBe(404)
	})

	it('GET 401s on a bad token when one is configured', async () => {
		const manager = createTerminalManager()
		manager.add('assistant')
		const routes = createTerminalRoutes(manager, { token: 'secret' })
		const get = findRoute(routes, 'GET')
		const response = await get.handler(new Request('http://x/terminals/assistant'), {
			params: { name: 'assistant' },
		})
		expect(response.status).toBe(401)
		const ok = await get.handler(
			new Request('http://x/terminals/assistant', { headers: { [HEADER_TOKEN]: 'secret' } }),
			{ params: { name: 'assistant' } },
		)
		expect(ok.status).toBe(200)
	})

	it('GET streams a replayed pending prompt, a live pending event, and an expire event; keepalive fires; abort ends the stream', async () => {
		const fake = createFakeTimer()
		const manager = createTerminalManager()
		manager.add('assistant', { timeout: 5, timer: fake.timer })
		const routes = createTerminalRoutes(manager, { timer: fake.timer, keepalive: 1000 })
		const get = findRoute(routes, 'GET')

		// Park a prompt BEFORE opening the stream so it is replayed.
		const asked = manager.ask('human', 'assistant', 'input', { message: 'name?' })
		asked.catch(() => {})

		const controller = new AbortController()
		const response = await get.handler(
			new Request('http://x/terminals/assistant', { signal: controller.signal }),
			{
				params: { name: 'assistant' },
			},
		)
		expect(response.status).toBe(200)

		const replayed = await readAvailable(response)
		expect(replayed).toContain('event: pending')
		expect(replayed).toContain('name?')

		// Live pending: ask a second prompt after the stream opened.
		const asked2 = manager.ask('human', 'assistant', 'input', { message: 'again?' })
		asked2.catch(() => {})
		const live = await readAvailable(response)
		expect(live).toContain('again?')

		// Keepalive: fire the route's own armed timer (index 1 — armed after the first `ask`'s
		// own timeout timer at index 0, and before the second `ask`'s timeout timer at index 2).
		fake.fire(1)
		const keepalive = await readAvailable(response)
		expect(keepalive.startsWith(':')).toBe(true)

		// Expire: fire the FIRST parked prompt's own timeout timer (index 0 — armed by `manager.ask`).
		fake.fire(0)
		const expired = await readAvailable(response)
		expect(expired).toContain('event: expire')

		controller.abort()
		await readAvailable(response)
	})

	it('POST 204s and resolves the parked ask on a valid answer', async () => {
		const manager = createTerminalManager()
		manager.add('assistant')
		const routes = createTerminalRoutes(manager)
		const post = findRoute(routes, 'POST')

		const asked = manager.ask('human', 'assistant', 'input', { message: 'name?' })
		const pending = manager.pending('assistant')
		const id = pending[0]?.id
		if (id === undefined) throw new Error('expected a parked prompt')

		const response = await post.handler(
			new Request('http://x/terminals/assistant', {
				method: 'POST',
				body: JSON.stringify({ id, value: 'Ada' }),
			}),
			{ params: { name: 'assistant' } },
		)
		expect(response.status).toBe(204)
		await expect(asked).resolves.toBe('Ada')
	})

	it('POST 422s on a malformed body', async () => {
		const manager = createTerminalManager()
		manager.add('assistant')
		const routes = createTerminalRoutes(manager)
		const post = findRoute(routes, 'POST')
		const response = await post.handler(
			new Request('http://x/terminals/assistant', {
				method: 'POST',
				body: JSON.stringify({ foo: 'bar' }),
			}),
			{ params: { name: 'assistant' } },
		)
		expect(response.status).toBe(422)
	})

	it('POST 400s on invalid JSON', async () => {
		const manager = createTerminalManager()
		manager.add('assistant')
		const routes = createTerminalRoutes(manager)
		const post = findRoute(routes, 'POST')
		const response = await post.handler(
			new Request('http://x/terminals/assistant', { method: 'POST', body: 'not json' }),
			{ params: { name: 'assistant' } },
		)
		expect(response.status).toBe(400)
	})

	it('POST 404s on an unknown endpoint name', async () => {
		const manager = createTerminalManager()
		const routes = createTerminalRoutes(manager)
		const post = findRoute(routes, 'POST')
		const response = await post.handler(
			new Request('http://x/terminals/ghost', {
				method: 'POST',
				body: JSON.stringify({ id: 'x', value: 1 }),
			}),
			{ params: { name: 'ghost' } },
		)
		expect(response.status).toBe(404)
	})

	it('POST 401s on a bad token when one is configured', async () => {
		const manager = createTerminalManager()
		manager.add('assistant')
		const routes = createTerminalRoutes(manager, { token: 'secret' })
		const post = findRoute(routes, 'POST')
		const response = await post.handler(
			new Request('http://x/terminals/assistant', {
				method: 'POST',
				body: JSON.stringify({ id: 'x', value: 1 }),
			}),
			{ params: { name: 'assistant' } },
		)
		expect(response.status).toBe(401)
	})
})
