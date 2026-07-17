import type { PendingPrompt, TerminalManagerInterface } from '@orkestrel/terminal'
import type { TerminalRoute, TerminalRouteContext, TerminalRoutesOptions } from './types.js'
import {
	defaultTimer,
	HEADER_TOKEN,
	isAnswerPayload,
	serializeExpire,
	serializePending,
} from '@orkestrel/terminal'
import { openStream } from '@orkestrel/server'
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
 * - **POST (answer).** Same token + `404` checks, then parses the JSON body (`400` on invalid
 *   JSON, `422` when it isn't an `{ id, value }` {@link import('@orkestrel/terminal').isAnswerPayload}
 *   shape), and routes it through `manager.answer` — `204` on success, `404` for `'terminal'`,
 *   `422` for `'unknown'` / `'rejected'`.
 *
 * @remarks
 * The `token` option is checked once per request at connect — a token that expires mid-stream
 * is not re-validated. Concurrent POST answerers race first-write-wins — a late POST for an
 * already-settled prompt returns `422`.
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
	const token = options?.token
	const keepalive = options?.keepalive ?? TERMINAL_KEEPALIVE_MS
	const timer = options?.timer ?? defaultTimer

	function authorized(request: Request): boolean {
		if (token === undefined) return true
		return request.headers.get(HEADER_TOKEN) === token
	}

	const get: TerminalRoute = {
		method: 'GET',
		path,
		handler(request: Request, context: TerminalRouteContext): Response {
			if (!authorized(request)) return new Response(null, { status: 401 })
			const name = context.params.name
			if (manager.terminal(name) === undefined) return new Response(null, { status: 404 })

			const stream = openStream()
			for (const prompt of manager.pending(name)) {
				const wire = serializePending(prompt)
				stream.write({ event: wire.event, data: wire.data, id: wire.id })
			}

			const pendingHandler = (prompt: PendingPrompt): void => {
				if (prompt.to !== name) return
				const wire = serializePending(prompt)
				stream.write({ event: wire.event, data: wire.data, id: wire.id })
			}
			const expireHandler = (to: string, id: string): void => {
				if (to !== name) return
				const wire = serializeExpire(id)
				stream.write({ event: wire.event, data: wire.data, id: wire.id })
			}

			manager.emitter.on('pending', pendingHandler)
			manager.emitter.on('expire', expireHandler)

			let cancelKeepalive = timer(function ping(): void {
				stream.comment('')
				cancelKeepalive = timer(ping, keepalive)
			}, keepalive)

			request.signal.addEventListener('abort', () => {
				cancelKeepalive()
				manager.emitter.off('pending', pendingHandler)
				manager.emitter.off('expire', expireHandler)
				stream.end()
			})

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

			let body: unknown
			try {
				body = await request.json()
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
