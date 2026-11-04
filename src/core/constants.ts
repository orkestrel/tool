/**
 * Holds the schema a tool that declares nothing advertises and enforces: a closed empty object.
 *
 * @remarks
 * A tool with neither `contract` nor `parameters` takes no arguments, so a call that sends a key
 * is refused. Frozen, and advertised by reference.
 */
export const CLOSED_PARAMETERS: Readonly<Record<string, unknown>> = Object.freeze({
	type: 'object',
	properties: Object.freeze({}),
	additionalProperties: false,
})

/**
 * Holds the schema a raw tool that declares nothing advertises: an open object.
 *
 * @remarks
 * A tool built with `strict: false` and neither `contract` nor `parameters` forwards any record
 * verbatim, so the advertised schema states that. Frozen, and advertised by reference.
 */
export const OPEN_PARAMETERS: Readonly<Record<string, unknown>> = Object.freeze({ type: 'object' })

/**
 * Caps at `2048` the characters of a refusal message, about 2 KB.
 *
 * @remarks
 * A refusal goes back to a model whose context window can be 2048 tokens, and an over-window
 * request refuses, so the text stops here and says how many faults it left out. The error's
 * `context.faults` still carries each of them up to `FAULT_LIMIT`.
 */
export const REFUSAL_TEXT_LIMIT = 2048

/** Caps at `12` the declared keys or literal candidates one refusal line names. */
export const REFUSAL_LIST_LIMIT = 12

/** Caps at `160` the characters a union refusal line spends summarizing one declared form. */
export const REFUSAL_SCHEMA_LIMIT = 160
