// The consumer-side guides-parity drop-in: runs `@orkestrel/guide`'s checks against
// this repo's own `guides/README.md` manifest. The constants that follow are this
// package's own, as is the executed section that closes the file.

import { GuideCommand } from '@orkestrel/guide/server'
import { readInventory } from '@orkestrel/test/server'
import { createVitest } from 'vitest/node'

/** Every fence language this package's guides are allowed to use. */
const FENCE_LANGUAGES = Object.freeze(['ts'])
/** The fence language whose blocks count as worked examples. */
const EXAMPLE_LANGUAGE = 'ts'
/** The one guide this package sources, whose tagline the README pitch equals. */
const GUIDE_SPEC = 'guides/tool.md'
/** The package identity the guide manifest and package manifest must share. */
const PACKAGE_MODULE = '@orkestrel/tool'
/** Each import specifier this package's own guides may resolve against. */
const MODULES = Object.freeze({ [PACKAGE_MODULE]: 'src/core', '@src/core': 'src/core' })
/**
 * Declarations deliberately kept out of the barrel, as `computeSymbolKey` strings.
 *
 * A class that one-class-per-file evicted from its single consumer cannot become a
 * local, so it stays exported without being public. Naming it here is what makes that
 * intentional rather than forgotten — and the assertion that follows it fails when a name
 * here stops being stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze([])

await new GuideCommand({
	root: new URL('../', import.meta.url),
	patterns: ['src/**/*.ts', 'tests/**/*.ts', 'guides/*.md', '*.md', 'package.json'],
	modules: MODULES,
	languages: FENCE_LANGUAGES,
	language: EXAMPLE_LANGUAGE,
	reader: readInventory,
	runner: createVitest,
}).execute(async ({ files, report, rows }) => {
	const { isRecord, parseJSON } = await import('@orkestrel/contract')
	const { computeSymbolKey, findMissingSymbols } = await import('@orkestrel/guide')
	const { requireValue } = await import('@orkestrel/test')
	const { Tool, createTool, createToolManager, isToolCall } = await import('@src/core')
	const { describe, expect, it } = await import('vitest')

	it('manifest lists at least one guide', () => {
		expect(report.input).toEqual([])
		expect(rows.length).toBeGreaterThan(0)
		expect(rows.map((row) => row.entry.spec)).toContain(GUIDE_SPEC)
	})

	// The example half of the equality case is silent over an empty population: with no
	// title on both sides `findDrift` compares no pair and the case passes on the summaries
	// alone. This pins the population this repository's own guide contributes, so removing
	// every `@example` title reddens the suite instead of quietly retiring half the gate.
	// The failure names both title sets, because a pin reporting only its own emptiness
	// leaves the reader to work out which side dropped the title.
	it('pairs at least one example title across the guide and the source', () => {
		expect(report.examples.titles.filter((finding) => finding.spec === GUIDE_SPEC)).toEqual([])
	})

	// The README's pitch and the guide's tagline are one text, each read as the blockquote
	// under its file's H1. `README.md` is outside the concept index, so the reader is
	// applied to it directly rather than through a manifest row. Each side is guarded
	// against `undefined` first, so a file that lost its blockquote reports that rather
	// than reporting two absences as agreement.
	it('opens the README with the guide tagline', () => {
		const manifest = parseJSON(requireValue(files['package.json'], 'Missing file: package.json'))
		expect(isRecord(manifest) ? manifest.name : undefined).toBe(PACKAGE_MODULE)
		expect(report.pitch).toEqual([])
	})

	for (const { entry, guide, source } of rows) {
		describe(`${entry.concept}`, () => {
			it('uses only listed fence languages', () => {
				expect(report.fences.filter((finding) => finding.spec === entry.spec)).toEqual([])
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

			it('carries every required populated section', () => {
				expect(report.sections.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('keeps behavioral interfaces and implementing classes in parity', () => {
				expect(report.methods.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('documents every behavioral declaration', () => {
				expect(report.declarations.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			// The equality gate: a `Summary` cell against its export's description paragraph, a
			// titled fence against the `@example` of that title. `findDrift` owns the comparison
			// and names both sides; converge the two sides with `npm run docs`, never by
			// weakening this assertion. `findDrift` pairs an example only where a title is
			// present on both sides, so an untitled `@example` block is outside this case. Each
			// collected line is the spec, the key, and each side's text or `absent` — the same
			// worklist `npm run docs` prints, so a failure here is read the way that command's
			// output is.
			it('keeps every compared summary and example equal to its source', () => {
				expect(report.drift.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('keeps the executable example population non-empty', () => {
				expect(report.examples.fences.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('documents an example for every Surface function', () => {
				expect(report.examples.functions.filter((finding) => finding.spec === entry.spec)).toEqual(
					[],
				)
			})

			it('documents an example for every method', () => {
				expect(report.examples.methods.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('imports only real exports in every ```ts fence', () => {
				expect(report.imports.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('resolves every relative link', () => {
				expect(report.links.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})
			it('links only to test files that exist', () => {
				expect(report.tests.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})
		})
	}

	// The EXECUTED half. Every preceding case reads a name — from guide text or from source
	// text — and a name that resolves proves nothing about the sentence beside it, so a fence
	// whose comment claims a value the code contradicts passes all of them. The cases here run
	// the flagship fences and assert the values their comments claim. Change a fence, change
	// the transcription beside it.
	describe('flagship fences', () => {
		const guideText = requireValue(files[GUIDE_SPEC], `Missing file: ${GUIDE_SPEC}`)
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
})
