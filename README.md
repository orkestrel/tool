# @orkestrel/agent

A typed **agent runtime** for the `@orkestrel` line — providers, tools,
conversations, workspaces, and a composable agent context. `createAgent`
composes a `ProviderInterface`, an `AgentContextInterface`, and a tool
registry into a bounded context → provider → tools → repeat turn, exposed as
a one-shot `generate` and a live `stream`. Part of the `@orkestrel` line.

## Install

```sh
npm install @orkestrel/agent
```

## Requirements

- Node.js >= 24
- Dual ESM + CommonJS builds (`import` and `require` both supported)

## Usage

```ts
import { createAgent, createTool, createToolManager } from '@orkestrel/agent'

const tools = createToolManager()
tools.add(
	createTool({
		name: 'add',
		description: 'Add two numbers',
		execute: (args) => Number(args.a) + Number(args.b),
	}),
)

// `provider` is your ProviderInterface implementation (see the guide)
const agent = createAgent(provider, { system: 'You are concise.', tools })
agent.context.messages.add({ role: 'user', content: 'Say hi.' })

const stream = agent.stream()
for await (const chunk of stream.events) {
	if (chunk.type === 'token') process.stdout.write(chunk.content)
}
const result = await stream.result // { content, usage?, partial }
```

## Guide

For the full surface — providers, the agent loop, tools, conversations,
workspaces, and the composable `AgentContext` — see
[`guides/src/agent.md`](guides/src/agent.md).

## Package

Published as a single typed entry point per the `exports` field in
`package.json`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
