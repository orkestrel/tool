# @orkestrel/tool

The tool runtime for the `@orkestrel` line: JSON-Schema definitions, model-emitted
calls, correlated results, executable tools, and an insertion-ordered registry with
per-call error isolation.

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
		description: 'Add two numbers.',
		parameters: {
			type: 'object',
			properties: {
				left: { type: 'number' },
				right: { type: 'number' },
			},
		},
		execute: (args) => Number(args.left) + Number(args.right),
	}),
)

const result = await tools.execute({
	id: 'call-1',
	name: 'add',
	arguments: { left: 2, right: 3 },
})
```

Handlers may be synchronous or asynchronous. A missing name or thrown handler becomes
an error result instead of escaping; batch execution isolates every call and preserves
input order.

See the [tool guide](guides/src/tool.md) for the complete surface and behavior.

## Requirements

- Node.js 22.12 or newer
- ESM and CommonJS consumers

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](LICENSE).
