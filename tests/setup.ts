import type { ContractInterface } from '@orkestrel/contract'
import type { ToolCall } from '@src/core'
import { objectShape } from '@orkestrel/contract'

/** Refuses a string conversion with the fixture's expected error. */
export function refuseConversion(): never {
	throw new Error('blocked string conversion')
}

// The fleet-wide helpers live in `@orkestrel/test`. What remains here is what is specific to this
// package: the tool call fixture, the argument shapes fixtures declare, and the schema tables.

/**
 * Creates a tool call for runtime tests.
 *
 * @param name - The tool name
 * @param args - The model-supplied arguments record
 * @param id - The correlation identifier
 * @returns A complete tool call
 */
export function createToolCall(
	name: string,
	args: Record<string, unknown> = {},
	id = 'call',
): ToolCall {
	return { id, name, arguments: args }
}

/**
 * Creates a parameter schema whose `properties` read throws, the one input the lenient
 * conversion refuses rather than widens.
 *
 * @returns A record the conversion cannot traverse
 */
export function createUnreadableSchema(): Readonly<Record<string, unknown>> {
	return Object.defineProperty({ type: 'object' }, 'properties', {
		enumerable: true,
		get: refuseConversion,
	})
}

/**
 * Wraps a real contract so each `explain` call is recorded, leaving every answer to the contract.
 *
 * @param contract - The contract that answers
 * @param record - Called once per `explain`
 * @returns A contract that behaves the same and reports its `explain` calls
 */
export function createExplainRecorder(
	contract: ContractInterface<unknown>,
	record: () => void,
): ContractInterface<unknown> {
	return {
		schema: contract.schema,
		is: contract.is,
		parse: contract.parse,
		audit: contract.audit,
		generate: contract.generate,
		explain: (value) => {
			record()
			return contract.explain(value)
		},
	}
}

/**
 * Creates a chain of closed objects, each holding one `child` key down to `depth`.
 *
 * @param depth - The objects the chain holds below its root
 * @returns The schema of the chain's root
 */
export function createChainSchema(depth: number): Readonly<Record<string, unknown>> {
	return Array.from({ length: depth }).reduce<Readonly<Record<string, unknown>>>(
		(inner) => ({ type: 'object', properties: { child: inner }, additionalProperties: false }),
		{ type: 'object', properties: {}, additionalProperties: false },
	)
}

/**
 * Creates the record the chain schema reads, holding `keys` at the object `depth` levels down.
 *
 * @param depth - The objects to descend through
 * @param keys - The keys of the deepest object, each holding the number `1`
 * @returns The chain's root record
 */
export function createChainArguments(
	depth: number,
	keys: readonly string[],
): Readonly<Record<string, unknown>> {
	return Array.from({ length: depth }).reduce<Readonly<Record<string, unknown>>>(
		(inner) => ({ child: inner }),
		Object.fromEntries(keys.map((key) => [key, 1])),
	)
}

/** Holds the open object shape a fixture declares when its handler reads arbitrary keys. */
export const OPEN_ARGUMENTS = objectShape({}, { additionalProperties: true })

/** Lists numeric texts whose coercion changes their meaning or notation. */
export const LOSSY_NUMBER_ARGUMENTS: readonly string[] = Object.freeze([
	'30.0',
	'007',
	'0x10',
	'1e3',
	'+5',
	'9007199254740993',
	'1e-400',
])

/** Holds a schema with closed object arms distinguished by a literal property. */
export const PET_PARAMETERS: Readonly<Record<string, unknown>> = Object.freeze({
	type: 'object',
	properties: {
		pet: {
			anyOf: [
				{
					type: 'object',
					properties: { kind: { const: 'a' }, x: { type: 'number' } },
					required: ['kind'],
					additionalProperties: false,
				},
				{
					type: 'object',
					properties: { kind: { const: 'b' }, y: { type: 'number' } },
					required: ['kind'],
					additionalProperties: false,
				},
			],
		},
	},
})

/** Lists titled values a `parameters` option holds that are not a plain record. */
export const NON_RECORD_PARAMETERS: ReadonlyArray<readonly [title: string, parameters: unknown]> =
	Object.freeze([
		['a string', 'x'],
		['a number', 5],
		['true', true],
		['false', false],
		['an array', []],
		['null', null],
		['a map', new Map()],
		['a date', new Date(0)],
	])

/**
 * Lists titled values `ToolManager.execute` receives that are not a `ToolCall`, each with the
 * `id` and `name` its failure result must carry.
 */
export const MALFORMED_CALLS: ReadonlyArray<
	readonly [title: string, call: unknown, id: string, name: string]
> = Object.freeze([
	['undefined arguments', { id: 'a', name: 'capture', arguments: undefined }, 'a', 'capture'],
	['absent arguments', { id: 'b', name: 'capture' }, 'b', 'capture'],
	['null arguments', { id: 'c', name: 'capture', arguments: null }, 'c', 'capture'],
	['array arguments', { id: 'd', name: 'capture', arguments: [] }, 'd', 'capture'],
	['string arguments', { id: 'e', name: 'capture', arguments: '{}' }, 'e', 'capture'],
	['a missing name', { id: 'f', arguments: {} }, 'f', ''],
	['a numeric id', { id: 5, name: 'capture', arguments: {} }, '', 'capture'],
	['undefined', undefined, '', ''],
	['a string', 'capture', '', ''],
])

/**
 * Lists titled parameter schemas carrying a `default` in each placement, with an argument record
 * the JSON Schema accepts, because `default` is an annotation and its placement never refuses a call.
 */
export const SCHEMA_DEFAULT_CALLS: ReadonlyArray<
	readonly [
		title: string,
		parameters: Readonly<Record<string, unknown>>,
		args: Readonly<Record<string, unknown>>,
	]
> = Object.freeze([
	['an open object', { type: 'object', properties: { limit: { type: 'number', default: 3 } } }, {}],
	[
		'an object declared open',
		{
			type: 'object',
			properties: { limit: { type: 'number', default: 3 } },
			additionalProperties: true,
		},
		{},
	],
	[
		'a closed object',
		{
			type: 'object',
			properties: { limit: { type: 'number', default: 3 } },
			additionalProperties: false,
		},
		{},
	],
	[
		'a required key',
		{
			type: 'object',
			properties: { limit: { type: 'number', default: 3 } },
			required: ['limit'],
			additionalProperties: false,
		},
		{ limit: 5 },
	],
	[
		'an open object nested in a closed one',
		{
			type: 'object',
			properties: {
				page: { type: 'object', properties: { limit: { type: 'number', default: 3 } } },
			},
			additionalProperties: false,
		},
		{ page: {} },
	],
	[
		'an anyOf arm at the root',
		{
			anyOf: [
				{
					type: 'object',
					properties: { limit: { type: 'number', default: 3 } },
					additionalProperties: false,
				},
				{ type: 'object', properties: { name: { type: 'string' } }, additionalProperties: false },
			],
		},
		{},
	],
	[
		'a oneOf arm at the root',
		{
			oneOf: [
				{ type: 'object', properties: { limit: { type: 'number', default: 3 } } },
				{ type: 'object', properties: { name: { type: 'string' } } },
			],
		},
		{ limit: 5 },
	],
	[
		'a nested anyOf arm',
		{
			type: 'object',
			properties: {
				page: {
					anyOf: [
						{ type: 'object', properties: { limit: { type: 'number', default: 3 } } },
						{ type: 'null' },
					],
				},
			},
		},
		{ page: null },
	],
	[
		'array items',
		{
			type: 'object',
			properties: {
				rows: {
					type: 'array',
					items: {
						type: 'object',
						properties: { limit: { type: 'number', default: 3 } },
						additionalProperties: false,
					},
				},
			},
		},
		{ rows: [{}] },
	],
	[
		'a null default',
		{
			type: 'object',
			properties: { label: { type: ['string', 'null'], default: null } },
			additionalProperties: false,
		},
		{},
	],
	[
		'a default its own type refuses',
		{
			type: 'object',
			properties: { limit: { type: 'number', default: 'many' } },
			additionalProperties: false,
		},
		{},
	],
	[
		'an object default',
		{
			type: 'object',
			properties: { page: { type: 'object', default: {} } },
			additionalProperties: false,
		},
		{},
	],
	[
		'an array default',
		{
			type: 'object',
			properties: { rows: { type: 'array', items: { type: 'string' }, default: [] } },
			additionalProperties: false,
		},
		{},
	],
	[
		'an enum default',
		{
			type: 'object',
			properties: { unit: { enum: ['c', 'f'], default: 'c' } },
			additionalProperties: false,
		},
		{},
	],
])

/**
 * Lists titled parameter schemas with an argument record the JSON Schema accepts, each built on
 * a keyword the lenient conversion must read or widen, so the Tool door never refuses it and hands
 * the handler an equal record.
 */
export const SCHEMA_VALID_CALLS: ReadonlyArray<
	readonly [
		title: string,
		parameters: Readonly<Record<string, unknown>>,
		args: Readonly<Record<string, unknown>>,
	]
> = Object.freeze([
	[
		'oneOf of const-discriminated objects',
		{
			oneOf: [
				{ type: 'object', properties: { kind: { const: 'a' } }, required: ['kind'] },
				{ type: 'object', properties: { kind: { const: 'b' } }, required: ['kind'] },
			],
		},
		{ kind: 'a' },
	],
	[
		'oneOf of const-discriminated objects with a payload',
		{
			oneOf: [
				{
					type: 'object',
					properties: { kind: { const: 'a' }, x: { type: 'string' } },
					required: ['kind'],
				},
				{
					type: 'object',
					properties: { kind: { const: 'b' }, y: { type: 'string' } },
					required: ['kind'],
				},
			],
		},
		{ kind: 'a', x: 's' },
	],
	[
		'oneOf of closed objects split by enum',
		{
			oneOf: [
				{
					type: 'object',
					properties: { kind: { enum: ['a'] } },
					required: ['kind'],
					additionalProperties: false,
				},
				{
					type: 'object',
					properties: { kind: { enum: ['b'] } },
					required: ['kind'],
					additionalProperties: false,
				},
			],
		},
		{ kind: 'a' },
	],
	[
		'oneOf arms split by pattern',
		{
			type: 'object',
			properties: {
				value: {
					oneOf: [
						{ type: 'string', pattern: '^a' },
						{ type: 'string', pattern: '^b' },
					],
				},
			},
		},
		{ value: 'abc' },
	],
	[
		'oneOf arms split by multipleOf',
		{
			type: 'object',
			properties: {
				value: {
					oneOf: [
						{ type: 'integer', multipleOf: 3 },
						{ type: 'integer', multipleOf: 5 },
					],
				},
			},
		},
		{ value: 9 },
	],
	[
		'oneOf with a true arm',
		{ type: 'object', properties: { value: { oneOf: [true, { type: 'string' }] } } },
		{ value: 5 },
	],
	[
		'anyOf with a true arm',
		{ type: 'object', properties: { value: { anyOf: [true, { type: 'string' }] } } },
		{ value: 5 },
	],
	[
		'anyOf with a false arm',
		{ type: 'object', properties: { value: { anyOf: [false, { type: 'string' }] } } },
		{ value: 'kept' },
	],
	[
		'nullable enum by type array',
		{
			type: 'object',
			properties: { unit: { type: ['string', 'null'], enum: ['c', 'f', null] } },
		},
		{ unit: null },
	],
	[
		'enum with a null entry',
		{ type: 'object', properties: { unit: { enum: ['c', null] } } },
		{ unit: null },
	],
	[
		'enum of null alone',
		{ type: 'object', properties: { unit: { enum: [null] } } },
		{ unit: null },
	],
	[
		'enum with an object entry',
		{ type: 'object', properties: { unit: { enum: [{ a: 1 }, 'x'] } } },
		{ unit: { a: 1 } },
	],
	[
		'enum with an array entry',
		{ type: 'object', properties: { unit: { enum: [[1, 2], 'x'] } } },
		{ unit: [1, 2] },
	],
	[
		'OpenAPI nullable',
		{ type: 'object', properties: { label: { type: 'string', nullable: true } } },
		{ label: null },
	],
	[
		'patternProperties under a closed object',
		{
			type: 'object',
			patternProperties: { '^x-': { type: 'string' } },
			additionalProperties: false,
		},
		{ 'x-a': 'b' },
	],
	[
		'patternProperties beside properties under a closed object',
		{
			type: 'object',
			properties: { a: { type: 'string' } },
			patternProperties: { '^x-': { type: 'string' } },
			additionalProperties: false,
		},
		{ a: 'q', 'x-a': 'b' },
	],
	[
		'prefixItems with items past the prefix',
		{
			type: 'object',
			properties: {
				row: { type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'number' } },
			},
		},
		{ row: ['a', 1] },
	],
	[
		'maxLength counted in code points',
		{ type: 'object', properties: { glyphs: { type: 'string', maxLength: 2 } } },
		{ glyphs: '\u{1F600}\u{1F600}' },
	],
	[
		'an open object with an undeclared key',
		{ type: 'object', properties: { a: { type: 'string' } } },
		{ a: 'x', b: 1 },
	],
	[
		'$ref into $defs',
		{
			type: 'object',
			properties: { a: { $ref: '#/$defs/x' } },
			required: ['a'],
			$defs: { x: { type: 'string' } },
		},
		{ a: 'x' },
	],
	[
		'allOf at the root',
		{
			allOf: [
				{ type: 'object', properties: { a: { type: 'string' } } },
				{ type: 'object', properties: { b: { type: 'string' } } },
			],
		},
		{ a: 'x', b: 'y' },
	],
	[
		'if and then',
		{
			type: 'object',
			if: { properties: { a: { const: 1 } } },
			then: { required: ['b'] },
		},
		{ a: 2 },
	],
])
