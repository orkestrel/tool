# @orkestrel/tool

The tool runtime for the `@orkestrel` line.

A tool is a callable function described by a JSON Schema: a name, an optional description, an
optional parameter schema, and the handler that runs it. That is the whole idea — a tool is an
API call whose shape is data, so whoever calls it can discover it, present it, and invoke it
without knowing anything about the code behind it. This package ships that shape and the
registry around it: definitions to advertise, calls to dispatch, results to correlate, and
per-call error isolation so one bad tool never takes down the run.

Nothing here is model-specific. An agent loop, an MCP bridge, and plain application code are all
just callers.

## Install

```sh
npm install @orkestrel/tool
```

## Example

```ts
import { createTool, createToolManager } from '@orkestrel/tool'

const tools = createToolManager()
tools.add(
	createTool({
		name: 'add',
		description: 'Add two numeric values and return their sum.',
		parameters: {
			type: 'object',
			properties: {
				left: { type: 'number' },
				right: { type: 'number' },
			},
			required: ['left', 'right'],
		},
		execute: (args) => Number(args.left) + Number(args.right),
	}),
)

tools.definitions() // hand these to whatever chooses the call

const result = await tools.execute({
	id: 'call-1',
	name: 'add',
	arguments: { left: 2, right: 3 },
})
if (result.success) {
	result.value // 5
} else {
	result.error // the failure message
}
```

Handlers may be synchronous or asynchronous. An unknown name or a thrown handler becomes an
error result instead of escaping, and a batch runs concurrently, stays isolated per call, and
answers in input order.

Ready-made tools ship in `@orkestrel/toolbox`.

See the [tool guide](guides/tool.md) for the complete surface and behavior.

## Requirements

- Node.js 22.12 or newer
- ESM and CommonJS consumers

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](LICENSE).
