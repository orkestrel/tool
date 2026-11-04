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
