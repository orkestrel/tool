# @orkestrel/tool

Concrete, LLM-callable **tools** for the `@orkestrel` line — workflow
authoring, workspace editing, and sub-agent delegation — built over
[`@orkestrel/agent`](https://github.com/orkestrel/agent)'s `ToolInterface` /
`createTool` runtime, with pluggable stores. Part of the `@orkestrel` line.

**Status: under construction.** The package shell, gates, and guide-parity
harness are in place; the concrete tools below are the roadmap.

## Install

```sh
npm install @orkestrel/tool
```

## Requirements

- Node.js >= 24
- Dual ESM + CommonJS builds (`import` and `require` both supported)

## Roadmap

- **Workflow authoring** — a tool for composing and editing
  [`@orkestrel/workflow`](https://github.com/orkestrel/workflow) definitions.
- **Workspace editing** — a tool wrapping an agent `Workspace`'s read /
  write / search / replace surface.
- **Sub-agent delegation** — a tool for dispatching bounded work to a
  sub-agent and returning its result.

## Guide

See [`guides/src/tool.md`](guides/src/tool.md).

## Package

Published as a single typed entry point per the `exports` field in
`package.json`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
