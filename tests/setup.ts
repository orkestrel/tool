import type {
	AgentJobInput,
	ContextFormatInterface,
	ConversationSnapshot,
	ConversationStoreInterface,
	ConversationSummarizer,
	MessageInterface,
	ProviderDelta,
	ProviderInterface,
	ProviderResult,
	ProviderStreamOptions,
	ToolCall,
	ToolDefinition,
	ToolInterface,
	WorkspaceSnapshot,
	WorkspaceStoreInterface,
} from '@src/core'
import type { TokenUsage } from '@orkestrel/budget'
import type { EmitterInterface, EventMap } from '@orkestrel/emitter'
import type { SchedulerInterface, SchedulerOptions } from '@orkestrel/workflow'
import {
	createBinaryContent,
	createConversation,
	createFile,
	createTextContent,
	createTool,
	createWorkspace,
	ProviderAbortError,
} from '@src/core'
import { describe, expect, it } from 'vitest'

/**
 * Resolve after `ms` milliseconds — the single shared delay helper (AGENTS §16.1),
 * for letting a real short timer elapse instead of inlining a `setTimeout` promise
 * per test.
 *
 * @param ms - Milliseconds to wait; defaults to `0` (a macrotask turn)
 * @returns A promise that resolves once the delay elapses
 */
export function waitForDelay(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Round-trip a value through `JSON.parse(JSON.stringify(...))`, returning the structurally
 * identical clone — the one shared form of the "driver-swap parity" check the store / snapshot
 * tests repeat (AGENTS §16.1). A JSON-backed store persists a snapshot AS JSON, so a
 * structurally-faithful, pure-JSON payload must survive the round-trip byte-for-byte; a test
 * asserts `roundTripJSON(snapshot)` deep-equals the original.
 *
 * @typeParam T - The value's type, preserved across the clone
 * @param value - The (JSON-serializable) value to round-trip
 * @returns A structurally identical deep clone of `value`
 */
export function roundTripJSON<T>(value: T): T {
	return JSON.parse(JSON.stringify(value))
}

/** A manually-settled promise — the `resolve` / `reject` lifted out of its executor. */
export interface TestGateInterface<T> {
	readonly promise: Promise<T>
	readonly resolve: (value: T) => void
	readonly reject: (error: unknown) => void
}

/**
 * Create a {@link TestGateInterface} — a deferred whose `promise` settles only when
 * the test calls `resolve` / `reject`. Lets a test gate a real handler on a signal it
 * controls, to prove ordering / concurrency / pause behaviour without racing wall-clock
 * timers (AGENTS §16.1).
 *
 * @typeParam T - The value the gate's `promise` resolves with
 * @returns A gate exposing its `promise` and its `resolve` / `reject`
 */
export function createGate<T = void>(): TestGateInterface<T> {
	let resolve: (value: T) => void = () => {}
	let reject: (error: unknown) => void = () => {}
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

// ── Scripted ProviderInterface (Ollama-free agent fixture) ───────────────────
//
// AGENTS §16.1: the ONE general scripted `ProviderInterface` every Ollama-free agent
// test drives — the agent-job tests, the deterministic loop tests (tool iteration, the
// chunk stream, generate↔stream parity, abort / budget bounds, status, the emitter),
// and the provider-agnosticism proof. The LIVE model is exercised separately in the
// `src:ollama` project. It is a real provider (NOT a mock of the agent): `stream`
// chunks the turn's content into deltas and RETURNS the result, honouring its `signal`
// between every delta exactly like the Ollama provider (an abort throws a
// `ProviderAbortError` carrying the accumulated partial), so a cancel threaded into the
// agent commits a genuine partial.

/**
 * One turn a {@link createScriptedProvider} replays — either a bare {@link ProviderResult}
 * (chunked by the provider's `deltasOf`) or a `{ result, deltas?, thoughts? }` pair whose per-turn
 * `deltas` override how that one turn's content streams and whose `thoughts` stream live
 * reasoning deltas before the content. A `deltas` of `[]` streams the content as zero deltas
 * (the result still returns).
 */
export type ScriptedTurn =
	| ProviderResult
	| {
			readonly result: ProviderResult
			readonly deltas?: readonly string[]
			readonly thoughts?: readonly string[]
	  }

/** One recorded `generate` / `stream` call on a {@link createScriptedProvider} (when `record`). */
export interface ScriptedCall {
	readonly messages: readonly MessageInterface[]
	readonly tools: readonly ToolDefinition[] | undefined
	readonly options: ProviderStreamOptions | undefined
}

/** How a {@link createScriptedProvider} chunks a turn's content into stream deltas. */
export type DeltasOf = (content: string) => readonly string[]

/**
 * Options for {@link createScriptedProvider} — every field optional, defaulting to the
 * original single-delta / repeat-on-exhaust behaviour.
 *
 * @remarks
 * - `delay` — ms paused at the start of each call (lets a test observe concurrency via
 *   `maxInFlight`); defaults to `0`.
 * - `name` — sets the provider's `id` and `name` (so a drop-in-swap test can prove two
 *   providers are distinguishable); defaults to `'scripted'`.
 * - `format` — a provider-default {@link ContextFormatInterface}, included on the provider
 *   ONLY when supplied (omitted ⇒ framing-agnostic, like the live OllamaProvider).
 * - `deltasOf` — how a turn's content is chunked into stream deltas; defaults to one whole
 *   delta (`(content) => [content]`). A per-turn `deltas` (the `{ result, deltas }` turn
 *   form) overrides this for that turn.
 * - `exhaust` — what happens once the turn list is consumed: `'repeat'` (the DEFAULT — the
 *   last turn repeats, so a job with extra tool-iterations still resolves) or `'throw'` (a
 *   call past the end throws, to assert a bounded loop never over-ran the script).
 * - `record` — when `true`, every call appends its `messages` / `tools` to `calls`.
 */
export interface ScriptedProviderOptions {
	readonly delay?: number
	readonly name?: string
	readonly format?: ContextFormatInterface
	readonly deltasOf?: DeltasOf
	readonly exhaust?: 'repeat' | 'throw'
	readonly record?: boolean
}

/**
 * A scripted {@link ProviderInterface} plus its live recorders — `maxInFlight` is the
 * high-water mark of concurrent calls (so a test can prove a queue / runner bounded the
 * agent jobs, e.g. `concurrency: 2` ⇒ `maxInFlight <= 2`), `started` counts calls, and
 * `calls` records each call's `messages` / `tools` (populated only under `record: true`).
 */
export interface ScriptedProviderInterface extends ProviderInterface {
	/** The highest number of `stream` calls in flight at once across this provider's life. */
	readonly maxInFlight: number
	/** How many `stream` calls have started in total. */
	readonly started: number
	/** Each call's `messages` / `tools`, in order — populated only when `record: true`. */
	readonly calls: readonly ScriptedCall[]
}

// Normalize a {@link ScriptedTurn} to its `{ result, deltas? }` parts — a bare result has
// no per-turn deltas (the `'result' in turn` discriminant narrows the union, §14, no `as`).
function turnParts(turn: ScriptedTurn): {
	readonly result: ProviderResult
	readonly deltas: readonly string[] | undefined
	readonly thoughts: readonly string[] | undefined
} {
	return 'result' in turn
		? { result: turn.result, deltas: turn.deltas, thoughts: turn.thoughts }
		: { result: turn, deltas: undefined, thoughts: undefined }
}

/**
 * Create the shared scripted {@link ProviderInterface} for deterministic, Ollama-free agent
 * tests — each `generate` / `stream` call consumes the next {@link ScriptedTurn}, streams
 * its content as deltas (per-turn `deltas`, else `deltasOf(content)`, else the whole content
 * as one delta), and RETURNS the turn's result. The call honours its `signal` between every
 * delta: an already-aborted (or mid-stream aborted) signal throws a `ProviderAbortError`
 * carrying the accumulated partial, so a cancel threaded into the agent commits a genuine
 * partial. Once the turn list is exhausted the last turn repeats (`exhaust: 'repeat'`, the
 * default) unless `exhaust: 'throw'` is set.
 *
 * @param turns - The {@link ScriptedTurn}s to replay in order (the last repeats by default)
 * @param options - The {@link ScriptedProviderOptions} (all optional; see its `@remarks`)
 * @returns A {@link ScriptedProviderInterface} (the provider + its recorders)
 */
export function createScriptedProvider(
	turns: readonly ScriptedTurn[],
	options?: ScriptedProviderOptions,
): ScriptedProviderInterface {
	const delay = options?.delay ?? 0
	const name = options?.name ?? 'scripted'
	const deltasOf = options?.deltasOf ?? ((content: string): readonly string[] => [content])
	const exhaust = options?.exhaust ?? 'repeat'
	const calls: ScriptedCall[] = []
	let index = 0
	let inFlight = 0
	let maxInFlight = 0
	let started = 0
	// Consume the next turn: past the end either repeat the last ('repeat') or throw ('throw').
	const next = (): ScriptedTurn => {
		if (index >= turns.length && exhaust === 'throw') {
			throw new Error(`createScriptedProvider exhausted at turn ${index}`)
		}
		const turn = turns[Math.min(index, turns.length - 1)] ?? { content: '' }
		index += 1
		return turn
	}
	async function* stream(
		messages: readonly MessageInterface[],
		signal: AbortSignal,
		tools?: readonly ToolDefinition[],
		run?: ProviderStreamOptions,
	): AsyncGenerator<ProviderDelta, ProviderResult> {
		if (options?.record === true) calls.push({ messages: [...messages], tools, options: run })
		started += 1
		inFlight += 1
		maxInFlight = Math.max(maxInFlight, inFlight)
		try {
			if (signal.aborted) throw new ProviderAbortError({ content: '' })
			if (delay > 0) await waitForDelay(delay)
			const turn = next()
			const { result, deltas, thoughts } = turnParts(turn)
			// Per-turn `deltas` win; else chunk the content via `deltasOf`.
			const chunks = deltas ?? deltasOf(result.content)
			let streamed = ''
			let reasoned = ''
			for (const thought of thoughts ?? []) {
				if (signal.aborted) {
					const partial: ProviderResult =
						reasoned.length > 0 ? { content: streamed, thinking: reasoned } : { content: streamed }
					throw new ProviderAbortError(partial)
				}
				reasoned += thought
				if (thought.length > 0) yield { type: 'thinking', text: thought }
			}
			for (const delta of chunks) {
				if (signal.aborted) {
					const partial: ProviderResult =
						reasoned.length > 0 ? { content: streamed, thinking: reasoned } : { content: streamed }
					throw new ProviderAbortError(partial)
				}
				streamed += delta
				if (delta.length > 0) yield { type: 'content', text: delta }
			}
			if (signal.aborted) {
				const partial: ProviderResult =
					reasoned.length > 0 ? { content: streamed, thinking: reasoned } : { content: streamed }
				throw new ProviderAbortError(partial)
			}
			return result
		} finally {
			inFlight -= 1
		}
	}
	return {
		id: name,
		name,
		...(options?.format === undefined ? {} : { format: options.format }),
		get maxInFlight() {
			return maxInFlight
		},
		get started() {
			return started
		},
		get calls() {
			return calls
		},
		stream,
		async generate(messages, signal, tools, run) {
			const generator = stream(messages, signal, tools, run)
			let step = await generator.next()
			while (!step.done) step = await generator.next()
			return step.value
		},
	}
}

// ── Agent data-stub factories (real shapes + per-test overrides) ─────────────
//
// AGENTS §16.1: the repeated agent DATA shapes — a tool call, a token usage, the
// canonical `add` / `loop` tools, an agent job — built ONCE as parameterized factories
// so a test stubs the shape it needs and customizes only the bit that matters, instead
// of re-typing the literal. These are REAL data builders (and, for the tools, real
// working `ToolInterface`s), NOT mocks of behaviour.

/**
 * Build a {@link ToolCall} for an agent / loop test — the verbose `{ id, name, arguments }`
 * literal folded into a call with a sensible default (`add` with no arguments) plus
 * per-call overrides, so a test names only the fields its scenario cares about.
 *
 * @param overrides - Fields to override on the default call (`{ id: 'c1', name: 'add', arguments: {} }`)
 * @returns The assembled tool call
 */
export function createToolCall(overrides?: Partial<ToolCall>): ToolCall {
	return { id: 'c1', name: 'add', arguments: {}, ...overrides }
}

/**
 * Build a {@link TokenUsage} for an agent / budget test — the default `{ prompt: 5,
 * completion: 7, total: 12 }`, with per-call overrides for a budget-triggering variant.
 *
 * @param overrides - Fields to override on the default usage
 * @returns The assembled token usage
 */
export function createTokenUsage(overrides?: Partial<TokenUsage>): TokenUsage {
	return { prompt: 5, completion: 7, total: 12, ...overrides }
}

/**
 * The canonical `add` tool — a REAL {@link ToolInterface} that returns a fixed `5`, the
 * single most-repeated tool literal across the agent loop / registry tests (where the loop
 * only needs SOME callable tool whose result feeds back, not a real summation). A data
 * builder, not a mock: a test that needs the tool to actually sum its arguments, or to
 * record its calls, keeps its own `createTool` closure.
 *
 * @returns A working `add` tool returning `5`
 */
export function addTool(): ToolInterface {
	return createTool({ name: 'add', execute: () => 5 })
}

/**
 * The canonical `loop` tool — a REAL {@link ToolInterface} that always returns `'again'`,
 * the tool the iteration-cap / budget / always-tool loop tests repeat. A data builder, not
 * a mock.
 *
 * @returns A working `loop` tool
 */
export function loopTool(): ToolInterface {
	return createTool({ name: 'loop', execute: () => 'again' })
}

/**
 * Build an {@link AgentJobInput} for an agent-job test — the default `{ provider: 'main',
 * messages: [{ role: 'user', content: 'go' }] }`, with per-call overrides so a test names
 * only the job fields its scenario varies (a different `provider` / `content`, a `tools`
 * list, a `budget`). A specific failure-scenario job (a budget ceiling, a tool list) is
 * expressed through overrides; a genuinely bespoke one stays local.
 *
 * @param overrides - Fields to override on the default job
 * @returns The assembled agent-job input
 */
export function createAgentJob(overrides?: Partial<AgentJobInput>): AgentJobInput {
	return { provider: 'main', messages: [{ role: 'user', content: 'go' }], ...overrides }
}

/**
 * Create a deterministic stub {@link ConversationSummarizer} for the conversation-layer tests
 * — a REAL `(messages) => Promise<string>` that digests the slice into `recap of <n>` (the
 * folded count), so a `compact()` produces a predictable section summary and the rollup is a
 * predictable summary-of-summaries (AGENTS §16.1: a data-stub, NOT a behavior-mock — the LIVE
 * model is exercised separately in the `src:ollama` project). Counts its calls so a test can
 * prove the TWO summarizer calls per compaction (the section digest + the rollup regeneration).
 *
 * @returns The summarizer plus a live `calls` recorder of every digested message-slice
 */
export function createStubSummarizer(): {
	readonly summarize: ConversationSummarizer
	readonly calls: readonly (readonly MessageInterface[])[]
} {
	const calls: (readonly MessageInterface[])[] = []
	return {
		get calls() {
			return calls
		},
		summarize: async (messages) => {
			calls.push(messages)
			return `recap of ${messages.length}`
		},
	}
}

// ── Call recorder (a real callback, not a mock) ──────────────────────────────
//
// AGENTS §16.1: when a test only needs to count calls or inspect arguments, use a
// recorder — a real listener that records every invocation — rather than a test-
// framework spy. `handler` is a genuine callback; `calls` is each invocation's
// argument tuple, in order.

/** A real call-recording callback over an argument tuple (AGENTS §16.1). */
export interface TestRecorderInterface<TArgs extends readonly unknown[]> {
	readonly calls: readonly TArgs[]
	readonly count: number
	readonly handler: (...args: TArgs) => void
	clear(): void
}

/**
 * Create a {@link TestRecorderInterface} — a real callback that records each
 * invocation's arguments, for asserting what fired and with what (AGENTS §16.1).
 *
 * @typeParam TArgs - The argument tuple the recorded handler receives
 * @returns A recorder whose `handler` records into `calls`
 */
export function createRecorder<TArgs extends readonly unknown[]>(): TestRecorderInterface<TArgs> {
	const calls: TArgs[] = []
	return {
		get calls() {
			return calls
		},
		get count() {
			return calls.length
		},
		handler(...args: TArgs) {
			calls.push(args)
		},
		clear() {
			calls.length = 0
		},
	}
}

/**
 * Create a recorder for an {@link import('@orkestrel/emitter').EmitterErrorHandler} — the
 * emitter's own listener-error channel (AGENTS §13): a `TestRecorderInterface<[error, event]>`
 * whose `handler` is wired as the `error` option, so an emit-safety test asserts a buggy
 * listener's throw was routed here (with the offending event name) instead of corrupting the
 * entity. Argument order is `(error, event)`, matching `EmitterErrorHandler`. A thin alias over
 * {@link createRecorder} (AGENTS §16.1 — extract-once over the per-entity emit-safety blocks).
 *
 * @returns A recorder of `[error: unknown, event: string]` calls
 */
export function createErrorRecorder(): TestRecorderInterface<
	readonly [error: unknown, event: string]
> {
	return createRecorder<readonly [error: unknown, event: string]>()
}

/**
 * A monotonic numeric resource allocator plus the recorders the pool / worker tests
 * assert against: `create` hands out `0, 1, 2, …` recording each into `created`, and
 * `destroyed` is the companion recorder a caller wires as the pool's `destroy` hook.
 */
export type EmitterRecorders<TMap extends EventMap, TName extends keyof TMap> = {
	readonly [K in TName]: TestRecorderInterface<TMap[K]>
}

/**
 * Wire one {@link createRecorder} onto `emitter` for each of the named events — the
 * one generic form of the per-entity `recordXEvents` bundles (AGENTS §16.1). Each
 * recorder subscribes via `emitter.on(name, recorder.handler)` and is returned keyed
 * by its event name, typed with that event's argument tuple — so a test asserts what
 * fired (`events.write.calls`) and with which payload, exactly as the local bundles did.
 *
 * @typeParam TMap - The emitter's {@link EventMap}
 * @typeParam TName - The subset of event names to record (inferred from `events`)
 * @param emitter - The emitter to subscribe the recorders to
 * @param events - The event names to record (each becomes a key of the result)
 * @returns A recorder per name, each subscribed and keyed by event name
 */
export function recordEmitterEvents<TMap extends EventMap, TName extends keyof TMap>(
	emitter: EmitterInterface<TMap>,
	events: readonly TName[],
): EmitterRecorders<TMap, TName> {
	// Accumulate into a `Partial` of the exact mapped shape — every value keeps its
	// precise per-event tuple type (a recorder is invariant in its argument tuple, so a
	// widened record won't hold it), all keys optional until assigned. Each recorder is
	// created against its event's tuple, so `on(name, handler)` is precisely typed as it
	// is wired. The dynamic key list is the untyped edge: once every listed name is
	// present we narrow `Partial` → total through a guard, never an assertion (§14).
	const recorders: Partial<EmitterRecorders<TMap, TName>> = {}
	for (const name of events) {
		const recorder = createRecorder<TMap[typeof name]>()
		emitter.on(name, recorder.handler)
		recorders[name] = recorder
	}
	if (!isTotal(recorders, events)) {
		throw new Error('recordEmitterEvents: a recorder was not wired for every event')
	}
	return recorders
}

/**
 * Narrow an accumulated `Partial<EmitterRecorders>` to its total mapped form once every
 * listed event has a recorder present — the §14 guard standing in for an assertion in
 * {@link recordEmitterEvents} (whose loop assigns one recorder per name, so this holds;
 * the explicit per-name presence check keeps the narrowing a sound guard, not a cast).
 *
 * @typeParam TMap - The emitter's {@link EventMap}
 * @typeParam TName - The subset of event names that must each have a recorder
 * @param recorders - The partially-accumulated recorder map to narrow
 * @param events - The event names that must all be present for the map to be total
 * @returns Whether every listed event has a recorder (narrowing `recorders` to total)
 */
export function isTotal<TMap extends EventMap, TName extends keyof TMap>(
	recorders: Partial<EmitterRecorders<TMap, TName>>,
	events: readonly TName[],
): recorders is EmitterRecorders<TMap, TName> {
	return events.every((name) => recorders[name] !== undefined)
}

/**
 * Drain an `AsyncIterable<T>` (an agent chunk stream) into an array — the
 * assertion-friendly counterpart to a streaming read (AGENTS §16.1).
 *
 * @typeParam T - The element type yielded by the iterable
 * @param iterable - The async source to consume to completion
 * @returns Every yielded value, in iteration order
 */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
	const values: T[] = []
	for await (const value of iterable) values.push(value)
	return values
}

/** A {@link SchedulerInterface} that records how many turn boundaries its `yield` paced. */
export interface RecordingSchedulerInterface extends SchedulerInterface {
	/** How many times `yield` ran — the turn boundaries the loop paced through this scheduler. */
	readonly yields: number
}

/**
 * Create a {@link RecordingSchedulerInterface} — a real `SchedulerInterface` whose
 * `yield` counts each call (the turn boundary it paced) and resolves immediately, so a
 * test can prove pacing ran BETWEEN turns (not after the last). It honours its signal
 * exactly like the real scheduler — an already-aborted signal rejects with the reason —
 * and its `delay` is a no-op. Not a mock: a genuine scheduler the agent loop drives.
 *
 * @returns A scheduler whose `yields` reports the turn boundaries it paced
 */
export function createRecordingScheduler(): RecordingSchedulerInterface {
	let yields = 0
	return {
		get yields() {
			return yields
		},
		async yield(options?: SchedulerOptions) {
			if (options?.signal?.aborted) throw options.signal.reason
			yields += 1
		},
		async delay() {},
	}
}

// ── Store-pair contract batteries (Memory ⇄ Database twins, environment-agnostic) ──
//
// AGENTS §16.1: the `{Memory,Database}{Conversation,Workspace}Store` twins each persist the
// SAME self-contained, pure-JSON snapshot behind the SAME `{X}StoreInterface` seam (get / set /
// delete, async, keyed by the snapshot's own id), so the round-trip / upsert / delete / two-ids
// battery is IDENTICAL across each pair. Each pair's snapshot builder + shared battery are
// promoted here so the contract lives in ONE place; every twin invokes the battery ONCE with its
// own store factory and KEEPS its twin-specific blocks local. Real data only — NO mocks. All
// plain `@src/core` (no `node:*` / DOM), so they load in every project. The assertions are
// plain-JSON `toEqual` (no class-identity `toBe`).

/**
 * Build a REAL {@link ConversationSnapshot} the way a conversation produces one — three turns
 * added, then a genuine `compact()` folds the oldest two into one summarized section + regenerates
 * the rollup `summary`, with the last message kept live (`keep: 1`). So the snapshot is NON-VACUOUS
 * in BOTH the compacted sections AND the live tail (and carries a rollup summary). The shared
 * store-test fixture both `{Memory,Database}ConversationStore` twins drive (AGENTS §16.1 — one
 * builder, not a per-file copy). The deterministic, provider-free summarizer is folded INSIDE
 * (digesting the slice into `recap(<contents>)` — NOT {@link createStubSummarizer}, whose `recap of
 * <n>` digest text differs), so a `compact()` produces a predictable section + rollup.
 *
 * @param id - The conversation id (and snapshot key); defaults to `'chat'`
 * @returns The settled conversation's snapshot (sections + live tail + rollup summary)
 */
export async function buildConversationSnapshot(id = 'chat'): Promise<ConversationSnapshot> {
	const conversation = createConversation({
		id,
		summarize: async (messages) => `recap(${messages.map((message) => message.content).join('|')})`,
		keep: 1,
	})
	conversation.add([
		{ role: 'user', content: 'first' },
		{ role: 'assistant', content: 'second' },
		{ role: 'user', content: 'third' },
	])
	// Fold the oldest two into one summarized section + regenerate the rollup; the last stays live.
	await conversation.compact()
	return conversation.snapshot()
}

/**
 * Run the SHARED `ConversationStoreInterface` contract battery against a store factory — the four
 * common describe blocks both `{Memory,Database}ConversationStore` twins prove identically
 * (AGENTS §16.1): round-trip (set → get returns an equal snapshot, sections + live tail + rollup
 * summary all surviving), upsert (set keys off the snapshot's own id, so re-setting REPLACES),
 * delete & absent (set → delete → get is `undefined`; a delete of an absent id is a no-op; get of
 * an absent id is `undefined`), and two-ids-coexist (distinct ids never clobber each other; dropping
 * one leaves the other intact). Each twin calls this ONCE with its own factory and keeps its
 * twin-specific blocks local. This helper OWNS its `describe` / `it` calls — invoke it inside a test
 * file, never at the setup module's top level.
 *
 * @param makeStore - Builds a fresh, empty store for each assertion (the twin's own factory)
 * @param build - The snapshot builder ({@link buildConversationSnapshot}); takes an optional id
 */
export function assertConversationStoreContract(
	makeStore: () => ConversationStoreInterface,
	build: (id?: string) => Promise<ConversationSnapshot>,
): void {
	describe('set → get round-trip (sections + live tail + rollup summary)', () => {
		it('set → get returns an equal snapshot (sections + tail + summary survive)', async () => {
			const store = makeStore()
			const snapshot = await build()
			await store.set(snapshot)
			const got = await store.get(snapshot.id)
			// The retrieved snapshot deep-equals what was stored (the durable payload survives intact).
			expect(got).toEqual(snapshot)
			// It carries a compacted section, a live tail, AND a rollup summary (round-trip is non-vacuous).
			expect(got?.sections).toHaveLength(1)
			expect(got?.sections[0]?.summary).toBe('recap(first|second)')
			expect(got?.sections[0]?.messages.map((message) => message.content)).toEqual([
				'first',
				'second',
			])
			expect(got?.messages.map((message) => message.content)).toEqual(['third'])
			expect(got?.summary).toBe('recap(recap(first|second))')
		})
	})

	describe('upsert (set replaces under the same id)', () => {
		it('set replaces an existing snapshot under the same id', async () => {
			// `set` keys off the snapshot's OWN id (no separate id param), so re-setting the same id
			// REPLACES — proving insert-or-replace semantics, not an append (one entry, latest wins).
			const store = makeStore()
			const first = await build('c')
			const second: ConversationSnapshot = {
				id: 'c',
				sections: [],
				messages: [{ id: 'm1', role: 'user', content: 'only' }],
			}
			await store.set(first)
			await store.set(second)
			expect(await store.get('c')).toEqual(second)
		})
	})

	describe('delete & absent', () => {
		it('set → delete → get returns undefined', async () => {
			const store = makeStore()
			const snapshot = await build()
			await store.set(snapshot)
			expect(await store.get(snapshot.id)).toBeDefined()
			await store.delete(snapshot.id)
			expect(await store.get(snapshot.id)).toBeUndefined()
		})

		it('deleting an absent id does not throw (a no-op)', async () => {
			const store = makeStore()
			await expect(store.delete('never-stored')).resolves.toBeUndefined()
		})

		it('get of an absent id returns undefined', async () => {
			const store = makeStore()
			expect(await store.get('never-stored')).toBeUndefined()
		})
	})

	describe('two distinct conversation ids coexist', () => {
		it('two distinct conversation ids coexist without cross-contamination', async () => {
			// A real durable store holds many conversations; distinct ids must not clobber each other.
			const store = makeStore()
			const alpha = await build('alpha')
			const beta = await build('beta')
			await store.set(alpha)
			await store.set(beta)
			expect(await store.get('alpha')).toEqual(alpha)
			expect(await store.get('beta')).toEqual(beta)
			// Dropping one leaves the other intact.
			await store.delete('alpha')
			expect(await store.get('alpha')).toBeUndefined()
			expect(await store.get('beta')).toEqual(beta)
		})
	})
}

/**
 * Build a REAL {@link WorkspaceSnapshot} carrying a TEXT file (written through the edit surface)
 * AND a BINARY file (`icon.png`, seated through `createFile` — the edit surface only ever mints
 * text). The genuine durable payload, built the way a real workspace produces it (both real Files,
 * pure JSON DATA by construction). The shared store-test fixture both `{Memory,Database}
 * WorkspaceStore` twins drive (AGENTS §16.1 — one builder, not a per-file copy).
 *
 * @param id - The workspace id (and snapshot key); defaults to `'scratch'`
 * @returns The workspace snapshot (one text file + one binary file)
 */
export function buildWorkspaceSnapshot(id = 'scratch'): WorkspaceSnapshot {
	const icon = createFile({ path: 'icon.png', content: createBinaryContent('AAAA', 'image/png') })
	const workspace = createWorkspace({ id })
	workspace.write('src/main.ts', 'const x = 1')
	const written = workspace.snapshot()
	// Compose the durable payload: the written text file + the seeded binary file (both real Files).
	return { id: written.id, files: [...written.files, icon] }
}

/**
 * Run the SHARED `WorkspaceStoreInterface` contract battery against a store factory — the four
 * common describe blocks both `{Memory,Database}WorkspaceStore` twins prove identically
 * (AGENTS §16.1): round-trip (set → get returns an equal snapshot, text + binary files surviving),
 * upsert (re-setting the same id REPLACES), delete & absent (set → delete → get is `undefined`; a
 * delete of an absent id is a no-op; get of an absent id is `undefined`), and two-ids-coexist
 * (distinct ids never clobber each other). Each twin calls this ONCE with its own factory and keeps
 * its twin-specific blocks local. OWNS its `describe` / `it` — invoke inside a test file, never at
 * the setup module's top level.
 *
 * @param makeStore - Builds a fresh, empty store for each assertion (the twin's own factory)
 * @param build - The snapshot builder ({@link buildWorkspaceSnapshot}); takes an optional id
 */
export function assertWorkspaceStoreContract(
	makeStore: () => WorkspaceStoreInterface,
	build: (id?: string) => WorkspaceSnapshot,
): void {
	describe('set → get round-trip (text + binary files)', () => {
		it('set → get returns an equal snapshot (text + binary files survive)', async () => {
			const store = makeStore()
			const snapshot = build()
			await store.set(snapshot)
			const got = await store.get(snapshot.id)
			// The retrieved snapshot deep-equals what was stored (the durable payload survives intact).
			expect(got).toEqual(snapshot)
			// It carries BOTH a text and a binary file (the round-trip is non-vacuous).
			expect(got?.files.map((file) => file.path)).toEqual(['src/main.ts', 'icon.png'])
		})
	})

	describe('upsert (set replaces under the same id)', () => {
		it('set replaces an existing snapshot under the same id', async () => {
			// `set` keys off the snapshot's OWN id (no separate id param), so re-setting the same id
			// REPLACES — proving insert-or-replace semantics, not an append (one entry, latest wins).
			const store = makeStore()
			const first = build('w')
			const second: WorkspaceSnapshot = {
				id: 'w',
				files: [createFile({ path: 'only.txt', content: createTextContent('only', 'text') })],
			}
			await store.set(first)
			await store.set(second)
			expect(await store.get('w')).toEqual(second)
		})
	})

	describe('delete & absent', () => {
		it('set → delete → get returns undefined', async () => {
			const store = makeStore()
			const snapshot = build()
			await store.set(snapshot)
			expect(await store.get(snapshot.id)).toBeDefined()
			await store.delete(snapshot.id)
			expect(await store.get(snapshot.id)).toBeUndefined()
		})

		it('deleting an absent id does not throw (a no-op)', async () => {
			const store = makeStore()
			await expect(store.delete('never-stored')).resolves.toBeUndefined()
		})

		it('get of an absent id returns undefined', async () => {
			const store = makeStore()
			expect(await store.get('never-stored')).toBeUndefined()
		})
	})

	describe('two distinct workspace ids coexist', () => {
		it('two distinct workspace ids coexist without cross-contamination', async () => {
			// A real durable store holds many workspaces; distinct ids must not clobber each other.
			const store = makeStore()
			const alpha = build('alpha')
			const beta = build('beta')
			await store.set(alpha)
			await store.set(beta)
			expect(await store.get('alpha')).toEqual(alpha)
			expect(await store.get('beta')).toEqual(beta)
			// Dropping one leaves the other intact.
			await store.delete('alpha')
			expect(await store.get('alpha')).toBeUndefined()
			expect(await store.get('beta')).toEqual(beta)
		})
	})
}
