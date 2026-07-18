import type { PendingPrompt, TerminalManagerInterface, TimerCancel } from '@orkestrel/terminal'
import type {
	TerminalRoute,
	TerminalRouteContext,
	TerminalRoutesOptions,
	TerminalToken,
} from './types.js'
import {
	defaultTimer,
	HEADER_TOKEN,
	isAnswerPayload,
	serializeExpire,
	serializePending,
} from '@orkestrel/terminal'
import { DEFAULT_BODY_LIMIT, openStream } from '@orkestrel/server'
import { TERMINAL_KEEPALIVE_MS, TERMINAL_ROUTES_PATH } from './constants.js'

// Server-package factories — the SSE + POST mount over a `TerminalManagerInterface`
// (`@orkestrel/terminal`), returned as plain structural `TerminalRoute` records (never
// `@orkestrel/router`'s own `Route`), so a consumer mounts them against ANY router that accepts
// the two-arg handler shape. Byte-compatible with `@orkestrel/terminal`'s own `PromptClient` —
// same GET url streams, same POST url answers, same `{ id, value }` body, same `x-orkestrel-token`
// header name.

/**
 * Build the two `TerminalManagerInterface` (`@orkestrel/terminal`) routes — a GET SSE stream and
 * a POST answer endpoint, both mounted on the SAME `:name`-templated path — that bridge a manager's
 * endpoints onto the wire, byte-compatible with `PromptClient`.
 *
 * @remarks
 * - **GET (SSE).** Optionally token-gated (`401` on mismatch), `404` when `name` names no
 *   endpoint. Opens a stream, replays every currently-{@link import('@orkestrel/terminal').PendingPrompt}
 *   as a `pending` frame, then live-forwards the manager's own `pending` / `expire` events scoped
 *   to `name`. A `keepalive`-interval `: ` comment ping is armed via the injected `timer` (default
 *   the host `setTimeout`). On the request's `AbortSignal` firing (client disconnect OR server
 *   stop) the keepalive is cancelled, both listeners unsubscribed, and the stream ended — no
 *   `shutdown` frame is sent, so a reconnecting client is never told the endpoint is gone.
 * - **POST (answer).** Same token + `404` checks, then reads the body capped at `options.limit`
 *   bytes (`413` over, `manager.answer` never called — see {@link TerminalRoutesOptions.limit}),
 *   parses the JSON body (`400` on invalid JSON, `422` when it isn't an `{ id, value }`
 *   {@link import('@orkestrel/terminal').isAnswerPayload} shape), and routes it through
 *   `manager.answer` — `204` on success, `404` for `'terminal'`, `422` for `'unknown'` / `'rejected'`.
 *
 * @remarks
 * The `token` option (a string OR a validator function — {@link TerminalToken}) is validated at
 * GET connect, on EVERY POST, and RE-VALIDATED on every keepalive tick of a live SSE stream — a
 * stream whose presented token stops validating is torn down rather than left streaming forever.
 * Concurrent POST answerers race first-write-wins — a late POST for an already-settled prompt
 * returns `422`.
 *
 * @param manager - The `TerminalManagerInterface` (`@orkestrel/terminal`) whose endpoints are bridged
 * @param options - See {@link TerminalRoutesOptions}
 * @returns Exactly two {@link TerminalRoute} records — GET then POST — sharing one path
 *
 * @example
 * ```ts
 * import { createTerminalRoutes } from '@src/server'
 * import { createTerminalManager } from '@orkestrel/terminal'
 *
 * const manager = createTerminalManager()
 * manager.add('assistant')
 * const routes = createTerminalRoutes(manager, { token: 'secret' })
 * // mount `routes` against any router accepting `{ method, path, handler }`
 * ```
 */
export function createTerminalRoutes(
	manager: TerminalManagerInterface,
	options?: TerminalRoutesOptions,
): readonly TerminalRoute[] {
	const path = options?.path ?? TERMINAL_ROUTES_PATH
	const token: TerminalToken | undefined = options?.token
	const keepalive = options?.keepalive ?? TERMINAL_KEEPALIVE_MS
	const timer = options?.timer ?? defaultTimer
	const limit = options?.limit ?? DEFAULT_BODY_LIMIT

	// Bounded body read — `@orkestrel/server`'s own `readBody` decodes by `Content-Type`
	// (`application/json` parses, anything else decodes as text), so a bare answer POST that
	// omits `Content-Type` (as this route's own byte-compatible `PromptClient` counterpart does)
	// would be decoded as TEXT rather than parsed JSON, changing the existing 400/422 status
	// mapping. Reading the body ourselves via the `ReadableStream` reader — capped at `limit`,
	// ignoring `Content-Length` entirely so a lying header can never bypass the cap — then
	// `JSON.parse`ing the accumulated text preserves that mapping exactly while still bounding
	// the read.
	async function readBoundedText(
		request: Request,
	): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false }> {
		const reader = request.body?.getReader()
		if (reader === undefined) return { ok: true, text: '' }
		const chunks: Uint8Array[] = []
		let received = 0
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			received += value.byteLength
			if (received > limit) {
				await reader.cancel()
				return { ok: false }
			}
			chunks.push(value)
		}
		const buffer = new Uint8Array(received)
		let offset = 0
		for (const chunk of chunks) {
			buffer.set(chunk, offset)
			offset += chunk.byteLength
		}
		return { ok: true, text: new TextDecoder().decode(buffer) }
	}

	// Single validation closure covering all three token shapes ({@link TerminalToken}):
	// `undefined` disables the check, a string is compared for equality, and a function is a
	// consumer-controlled validator — used at GET connect, on every POST, and re-run on every
	// keepalive tick against the connection's captured presented header value, so a token that
	// rotates or expires mid-stream tears the stream down instead of streaming forever. A
	// validator that THROWS is treated as invalid (fail-closed) at all three call sites — a throw
	// escaping the keepalive tick's timer callback would otherwise skip teardown entirely and
	// crash the timer host.
	function valid(presented: string | undefined): boolean {
		if (token === undefined) return true
		try {
			return typeof token === 'function' ? token(presented) : presented === token
		} catch {
			return false
		}
	}

	function authorized(request: Request): boolean {
		return valid(request.headers.get(HEADER_TOKEN) ?? undefined)
	}

	const get: TerminalRoute = {
		method: 'GET',
		path,
		handler(request: Request, context: TerminalRouteContext): Response {
			if (!authorized(request)) return new Response(null, { status: 401 })
			const name = context.params.name
			if (manager.terminal(name) === undefined) return new Response(null, { status: 404 })
			const presented = request.headers.get(HEADER_TOKEN) ?? undefined

			const stream = openStream()
			for (const prompt of manager.pending(name)) {
				const wire = serializePending(prompt)
				stream.write({ event: wire.event, data: wire.data, id: wire.id })
			}

			// Shared teardown — the ONE place that cancels the keepalive and detaches all
			// listeners (both manager listeners and the request's `abort` listener), so the
			// abort path and the self-heal path (a stream that closed without the request's
			// `AbortSignal` firing, e.g. a consumer that only cancels its reader) can never
			// drift apart. `cancelKeepalive`/`stream.end`/`removeEventListener` are safe
			// no-ops if already run — teardown itself is idempotent.
			let cancelKeepalive: TimerCancel = () => {}
			const teardown = (): void => {
				cancelKeepalive()
				manager.emitter.off('pending', pendingHandler)
				manager.emitter.off('expire', expireHandler)
				request.signal.removeEventListener('abort', teardown)
				stream.end()
			}

			const pendingHandler = (prompt: PendingPrompt): void => {
				if (prompt.to !== name) return
				if (stream.closed) {
					teardown()
					return
				}
				const wire = serializePending(prompt)
				stream.write({ event: wire.event, data: wire.data, id: wire.id })
			}
			const expireHandler = (to: string, id: string): void => {
				if (to !== name) return
				if (stream.closed) {
					teardown()
					return
				}
				const wire = serializeExpire(id)
				stream.write({ event: wire.event, data: wire.data, id: wire.id })
			}

			manager.emitter.on('pending', pendingHandler)
			manager.emitter.on('expire', expireHandler)

			cancelKeepalive = timer(function ping(): void {
				if (stream.closed) {
					teardown()
					return
				}
				if (!valid(presented)) {
					teardown()
					return
				}
				stream.comment('')
				cancelKeepalive = timer(ping, keepalive)
			}, keepalive)

			request.signal.addEventListener('abort', teardown)

			return stream.response
		},
	}

	const post: TerminalRoute = {
		method: 'POST',
		path,
		async handler(request: Request, context: TerminalRouteContext): Promise<Response> {
			if (!authorized(request)) return new Response(null, { status: 401 })
			const name = context.params.name
			if (manager.terminal(name) === undefined) return new Response(null, { status: 404 })

			const bounded = await readBoundedText(request)
			if (!bounded.ok) return new Response(null, { status: 413 })

			let body: unknown
			try {
				body = JSON.parse(bounded.text)
			} catch {
				return new Response(null, { status: 400 })
			}
			if (!isAnswerPayload(body)) return new Response(null, { status: 422 })

			const result = manager.answer(name, body.id, body.value)
			if (result.success) return new Response(null, { status: 204 })
			if (result.error === 'terminal') return new Response(result.error, { status: 404 })
			return new Response(result.error, { status: 422 })
		},
	}

	return [get, post]
}
