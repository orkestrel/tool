import type { TimerHandler } from '@orkestrel/terminal'

// Server-package types — the structural route contract this barrel returns, kept LOCAL (never
// imports `@orkestrel/router`) so a consumer mounts the two returned routes against ANY router
// that accepts this shape (AGENTS §5: types are the source of truth).

/** The HTTP method literal a {@link TerminalRoute} declares — the exact 7-literal union `@orkestrel/router`'s `Method` accepts. */
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

/**
 * The minimal route-dispatch context a {@link TerminalRoute} handler reads — exactly the frozen,
 * URL-decoded `:name` path param slice a router hands a matched handler.
 */
export interface TerminalRouteContext {
	readonly params: Readonly<Record<string, string>>
}

/**
 * One structural route record {@link import('./factories.js').createTerminalRoutes} returns — a
 * plain `{ method, path, handler }` shape carrying NO dependency on `@orkestrel/router`'s own
 * `Route` type, so a consumer mounts it against any router that accepts a two-arg
 * `(request, context) => Response | Promise<Response>` handler keyed by `method` + `path`.
 */
export interface TerminalRoute {
	readonly method: Method
	readonly path: string
	readonly handler: (
		request: Request,
		context: TerminalRouteContext,
	) => Response | Promise<Response>
}

/**
 * Options for {@link import('./factories.js').createTerminalRoutes}.
 *
 * @remarks
 * - `path` — the shared `:name`-templated path both the GET (SSE) and POST (answer) routes
 *   mount under; defaults to {@link import('./constants.js').TERMINAL_ROUTES_PATH}.
 * - `token` — when set, both routes require the `x-orkestrel-token` header to equal it (a
 *   missing/mismatched header is rejected `401`); omitted ⇒ no auth check.
 * - `keepalive` — the SSE comment-ping interval in milliseconds; defaults to
 *   {@link import('./constants.js').TERMINAL_KEEPALIVE_MS}.
 * - `timer` — the injected {@link TimerHandler} driving the keepalive interval (default the host
 *   `setTimeout`/`clearTimeout`), so a test drives the keepalive deterministically.
 */
export interface TerminalRoutesOptions {
	readonly path?: string
	readonly token?: string
	readonly keepalive?: number
	readonly timer?: TimerHandler
}
