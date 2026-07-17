import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { srcServer, resolveWorkspacePath, rewriteCoreEntry } from '../../vite.config'

// Types are bundled by vite-plugin-dts (see configs/src/vite.core.config.ts for the
// same pattern); the `afterBuild` hook normalizes the bundled entry's external
// core-type imports to the shipped `../core/index.js` (see `rewriteCoreEntry`).
export default defineConfig(
	srcServer({
		plugins: [
			dts({
				tsconfigPath: resolveWorkspacePath('configs/src/tsconfig.server.json'),
				// Unlike terminal's server barrel, tool's server barrel imports only
				// external `@orkestrel/*` packages and nothing from `@src/core`, so the
				// dts plugin has no in-tree anchor to infer `src/server` as the entry
				// root: bundling mis-scopes the build (emits core's types "outside" the
				// root and never writes dist/src/server/index.d.ts). Emit per-file
				// declarations instead — index.d.ts still re-exports the barrel.
				bundleTypes: false,
				entryRoot: resolveWorkspacePath('src/server'),
				afterBuild: rewriteCoreEntry('dist/src/server'),
			}),
		],
	}),
)
