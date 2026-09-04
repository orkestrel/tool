// The consumer-side guides-parity drop-in: runs `@orkestrel/guide`'s checks against
// this repo's own `guides/README.md` manifest. The constants that follow are this
// package's own, and are the only part a sibling package changes.

import { Tool, createTool, createToolManager, isToolCall } from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	computeSymbolKey,
	createGuide,
	createSource,
	createSourceManager,
	extractFenceImports,
	findMissing,
	findMissingSymbols,
	findUnexampled,
	findUnlisted,
	isExternalLink,
	parseManifest,
	resolveLink,
} from '@orkestrel/guide'
import { readFileSync } from 'node:fs'
import { requireValue } from '@orkestrel/test'
import { readInventory } from '@orkestrel/test/server'

/** Every fence language this package's guides are allowed to use. */
const FENCE_LANGUAGES = Object.freeze(['ts'])
/** The fence language whose blocks count as worked examples. */
const EXAMPLE_LANGUAGE = 'ts'
/** Each import specifier this package's own guides may resolve against. */
const MODULES = Object.freeze({ '@orkestrel/tool': 'src/core', '@src/core': 'src/core' })
/**
 * Declarations deliberately kept out of the barrel, as `computeSymbolKey` strings.
 *
 * A class that one-class-per-file evicted from its single consumer cannot become a
 * local, so it stays exported without being public. Naming it here is what makes that
 * intentional rather than forgotten — and the assertion that follows fails when a name
 * here stops being stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze([])

/** Root-level files this package's guides link to. `readInventory` walks directories only. */
const ROOT_FILES = Object.freeze(['AGENTS.md'])

const root = new URL('../', import.meta.url)
const files: Record<string, string> = {
	...readInventory(root, ['src', 'guides', 'tests'], { extensions: ['.ts', '.md'] }),
}
for (const name of ROOT_FILES) files[name] = readFileSync(new URL(name, root), 'utf8')
const manifest = parseManifest(
	requireValue(files['guides/README.md'], 'Missing file: guides/README.md'),
	'guides',
)
const sources = createSourceManager({ files, modules: MODULES })

it('manifest lists at least one guide', () => {
	expect(manifest.length).toBeGreaterThan(0)
})

for (const entry of manifest) {
	const guide = createGuide(requireValue(files[entry.spec], `Missing file: ${entry.spec}`))
	const source = createSource({ files, module: entry.source })

	describe(`${entry.concept}`, () => {
		it('uses only listed fence languages', () => {
			expect(findUnlisted(guide.fences(), FENCE_LANGUAGES)).toEqual([])
		})

		it('extracts a non-empty documented surface', () => {
			expect(guide.surface().length).toBeGreaterThan(0)
		})
		it('re-exports every direct declaration that is not named internal', () => {
			const stranded = findMissingSymbols(source.exports(), source.surface())
			expect(stranded.filter((key) => !INTERNAL.includes(key))).toEqual([])
		})
		it('names no symbol internal that the barrel already exports', () => {
			const stranded = findMissingSymbols(source.exports(), source.surface())
			expect(INTERNAL.filter((key) => !stranded.includes(key))).toEqual([])
		})
		it('re-exports only direct declarations', () => {
			expect(findMissingSymbols(source.surface(), source.exports())).toEqual([])
		})
		it('documents every barrel export', () => {
			expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
		})
		it('documents only barrel exports', () => {
			expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
		})

		it('exposes no hidden module-scope declarations', () => {
			expect(source.hidden().map(computeSymbolKey)).toEqual([])
		})

		for (const group of guide.methods()) {
			const members = source.methods(group.interface)
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface}`, () => {
				it('documents at least one method', () => {
					expect(group.methods.length).toBeGreaterThan(0)
				})
				it('documents every interface method', () => {
					expect(findMissing(members, group.methods)).toEqual([])
				})
				it('documents no phantom method', () => {
					expect(findMissing(group.methods, members)).toEqual([])
				})
				it(`${entity} exposes no undocumented method`, () => {
					const extra =
						entity === group.interface ? [] : findMissing(source.methods(entity), group.methods)
					expect(extra).toEqual([])
				})
			})
		}

		it('documents an example for every Surface function', () => {
			const fences = guide
				.fences()
				.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
				.map((fence) => fence.code)
			const names = guide
				.surface()
				.filter((symbol) => symbol.keyword === 'function')
				.map((symbol) => symbol.name)
			expect(findUnexampled(names, fences, source.examples())).toEqual([])
		})

		for (const group of guide.methods()) {
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface} examples`, () => {
				it('documents an example for every method', () => {
					const fences = guide
						.fences()
						.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
						.map((fence) => fence.code)
					const examples =
						entity === group.interface
							? source.examples(group.interface)
							: source.examples(group.interface).concat(source.examples(entity))
					expect(findUnexampled(group.methods, fences, examples)).toEqual([])
				})
			})
		}

		it('imports only real exports in every ```ts fence', () => {
			const fences = guide.fences().filter((fence) => fence.language === EXAMPLE_LANGUAGE)
			for (const fence of fences) {
				for (const { specifier, names } of extractFenceImports(fence.code)) {
					const imported = sources.source(specifier)
					if (imported === undefined) continue
					const surface = imported.surface().map((symbol) => symbol.name)
					expect(findMissing(names, surface)).toEqual([])
				}
			}
		})

		it('resolves every relative link', () => {
			const broken = guide
				.links()
				.filter((href) => !isExternalLink(href))
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(broken).toEqual([])
		})
		it('links only to test files that exist', () => {
			const missing = guide
				.tests()
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(missing).toEqual([])
		})
	})
}

// The EXECUTED half. Every preceding case reads a name — from guide text or from source
// text — and a name that resolves proves nothing about the sentence beside it, so a fence
// whose comment claims a value the code contradicts passes all of them. The cases here run
// the flagship fences and assert the values their comments claim. Change a fence, change
// the transcription beside it.
describe('flagship fences', () => {
	const guideText = requireValue(files['guides/tool.md'], 'Missing file: guides/tool.md')
	// The anatomy fence's tool, built once. Both flagship fences register this same tool.
	const add = createTool({
		name: 'add',
		description: 'Add two numeric values and return their sum. Both operands are required.',
		summary: 'Add two numbers.',
		parameters: {
			type: 'object',
			properties: {
				left: { type: 'number' },
				right: { type: 'number' },
			},
			required: ['left', 'right'],
		},
		execute: (args) => Number(args.left) + Number(args.right),
	})

	it('counts, orders, and removes exactly as the registry fence claims', () => {
		const tools = createToolManager()
		tools.add(add)
		tools.add([
			new Tool({ name: 'echo', execute: (args) => args.value }),
			new Tool({
				name: 'now',
				description: 'Current epoch milliseconds.',
				execute: () => Date.now(),
			}),
		])

		expect(tools.count).toBe(3)
		expect(tools.tools().map((tool) => tool.name)).toEqual(['add', 'echo', 'now'])
		expect(tools.remove('echo')).toBe(true)
		expect(tools.remove(['now', 'ghost'])).toBe(false)

		tools.clear()

		expect(tools.count).toBe(0)
	})

	it('carries the registry fence lines the transcription copies', () => {
		// The presence guard beside the transcription: it proves the transcribed lines are
		// still the documented ones, and nothing whatever about behavior. Every line that
		// carries a claim is bound, so a comment cannot drift to the opposite value and stay
		// green.
		expect(guideText).toContain('tools.count // 3')
		expect(guideText).toContain("tools.remove('echo') // true")
		expect(guideText).toContain("tools.remove(['now', 'ghost']) // false")
	})

	it('guards, executes, and batches exactly as the calls fence claims', async () => {
		// The registry fence ends on `tools.clear()`, so a literal sequential transcription
		// would answer `tool not found: add`. Registering `add` again is what makes this the
		// case the calls fence documents.
		const tools = createToolManager()
		tools.add(add)
		const incoming: unknown = {
			id: 'call-1',
			name: 'add',
			arguments: { left: 2, right: 3 },
			caller: { subject: 'user-42' },
		}

		expect(isToolCall(incoming)).toBe(true)
		if (!isToolCall(incoming)) throw new Error('the fence envelope failed its own guard')

		const result = await tools.execute(incoming)

		expect(result.success).toBe(true)
		const value = result.success ? result.value : undefined
		expect(value).toBe(5)

		const batch = await tools.execute([
			{ id: '1', name: 'add', arguments: { left: 2, right: 3 } },
			{ id: '2', name: 'ghost', arguments: {} },
		])

		expect(batch).toEqual([
			{ id: '1', name: 'add', success: true, value: 5 },
			{ id: '2', name: 'ghost', success: false, error: 'tool not found: ghost' },
		])
	})

	it('carries the calls fence lines the transcription copies', () => {
		expect(guideText).toContain('result.value // 5')
		expect(guideText).toContain("// → { id: '1', name: 'add', success: true, value: 5 }")
		expect(guideText).toContain(
			"// → { id: '2', name: 'ghost', success: false, error: 'tool not found: ghost' }",
		)
	})
})
