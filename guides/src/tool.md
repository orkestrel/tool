# Tool

> The `@orkestrel/tool` runtime defines JSON-Schema tool definitions, model-emitted
> calls, correlated results, executable tools, and an insertion-ordered registry with
> per-call error isolation. Callers include agent loops, MCP bridges, and plain code.
> Source: [`src/core`](../../src/core). Published through `@orkestrel/tool`.

A tool combines the definition advertised to a model with a local execution handler.
The registry projects executable tools back to plain definitions, using a concise
summary in place of the full description when one is available. Each call always
resolves to a correlated result: missing names and handler failures become error
strings, while successful values—including falsy, null, and undefined values—remain
successful results. Batch calls execute concurrently and preserve input order.

## Surface

### Contracts

| Name                   | Kind      | Shape / Purpose                                                                                                   |
| ---------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| `ToolDefinition`       | interface | The name, optional description, and optional JSON-Schema parameters advertised to a model.                        |
| `ToolCall`             | interface | A correlation id, tool name, and model-supplied arguments record.                                                 |
| `ToolResult`           | interface | A correlated success value or failure message.                                                                    |
| `ToolInterface`        | interface | An advertised definition with an optional summary and an execution method. See [Methods](#methods).               |
| `ToolOptions`          | interface | Construction fields for an executable tool: its definition, optional summary, and handler.                        |
| `ToolManagerInterface` | interface | The registry contract for registration, advertisement, execution, removal, and clearing. See [Methods](#methods). |

### Implementations

| Name          | Kind  | Purpose                                                                                         |
| ------------- | ----- | ----------------------------------------------------------------------------------------------- |
| `Tool`        | class | Binds a definition and optional summary to a synchronous or asynchronous handler.               |
| `ToolManager` | class | Stores tools by name, advertises definitions, and executes calls with per-call error isolation. |

### Factories and helpers

| Name                | Kind     | Purpose                                                        |
| ------------------- | -------- | -------------------------------------------------------------- |
| `createTool`        | function | Creates a `ToolInterface` from `ToolOptions`.                  |
| `createToolManager` | function | Creates an empty `ToolManagerInterface`.                       |
| `isToolCall`        | function | Narrows an unknown value to the complete `ToolCall` structure. |

## Methods

The public call-signature members of each behavioral interface.

#### `ToolInterface`

| Method    | Returns                       | Behavior                                                  |
| --------- | ----------------------------- | --------------------------------------------------------- |
| `execute` | `Promise<unknown> \| unknown` | Runs the handler with the model-supplied argument record. |

#### `ToolManagerInterface`

| Method        | Returns                                        | Behavior                                                                                   |
| ------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `add`         | `void`                                         | Registers one tool or a readonly batch; an existing name is overwritten in place.          |
| `tool`        | `ToolInterface \| undefined`                   | Finds one registered tool by name.                                                         |
| `tools`       | `readonly ToolInterface[]`                     | Returns the registered tools in insertion order.                                           |
| `definitions` | `readonly ToolDefinition[]`                    | Returns plain advertised definitions, preferring each tool's summary over its description. |
| `execute`     | `Promise<ToolResult \| readonly ToolResult[]>` | Executes one call or a readonly batch with per-call error isolation.                       |
| `remove`      | `boolean`                                      | Removes one name or a readonly name batch and reports whether any tool was removed.        |
| `clear`       | `void`                                         | Removes every registered tool.                                                             |

## Usage

Create tools with JSON-Schema parameters, register them, advertise their definitions,
and execute model calls through the same registry:

```ts
import { Tool, ToolManager, createTool, createToolManager, isToolCall } from '@orkestrel/tool'

const add = createTool({
	name: 'add',
	description: 'Add two numeric values and return their sum.',
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

const tools = createToolManager()
tools.add(add)
tools.add([new Tool({ name: 'echo', execute: (args) => args.value })])

tools.count
tools.tool('add')
tools.tools()
tools.definitions()

const input: unknown = {
	id: 'call-1',
	name: 'add',
	arguments: { left: 2, right: 3 },
}

if (isToolCall(input)) {
	const result = await tools.execute(input)
	result.value
}

tools.remove('echo')
tools.clear()

const direct = new ToolManager()
direct.add(add)
```

The schema is descriptive runtime data: handlers still receive an open argument record
and must narrow the fields they consume. `isToolCall` validates the envelope itself; it
does not validate arguments against a tool's JSON Schema.

## Registry behavior

Definitions are newly projected on each call. Optional description and parameters fields
are omitted when absent, and parameters retain their original object identity. A summary
changes only the projected description; the full description remains on the registered
tool for on-demand retrieval.

Adding the same name again replaces the stored tool without moving its insertion
position. Removing and later re-adding the name creates a fresh insertion at the end.
Arrays returned by `tools` and `definitions` are new readonly views and do not expose the
registry's internal map.

Execution forwards the exact arguments record to the handler. Synchronous throws and
asynchronous rejections are both contained. An `Error` contributes its message;
non-`Error` thrown values are converted with `String`. An unknown name produces
`tool not found: <name>`. Batch execution uses the same isolated single-call behavior for
every element and preserves positional correlation, including duplicate call ids.

## Tests

- [`Tool.test.ts`](../../tests/src/core/tools/Tool.test.ts) — definition binding, argument identity, return values, and unisolated handler failures.
- [`ToolManager.test.ts`](../../tests/src/core/tools/ToolManager.test.ts) — registry ordering, advertisement, overwrite/removal lifecycle, and isolated single/batch execution.
- [`factories.test.ts`](../../tests/src/core/factories.test.ts) — factory construction and working instances.
- [`helpers.test.ts`](../../tests/src/core/helpers.test.ts) — tool-call envelope boundaries.
