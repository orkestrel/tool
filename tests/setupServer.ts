// Server-test setup — node-only helpers, loaded after `setup.ts` for the node `src:server` test
// project. `node:*` imports belong here, never in `setup.ts`. Currently empty: the `src:server`
// suite drives its handlers directly against real `@orkestrel/terminal` managers and the Fetch
// API's own `Request`/`Response`/`AbortController` (all globally available under `node24`), so no
// shared node-only fixture is needed yet.
export {}
