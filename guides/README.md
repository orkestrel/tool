# Guides

A concept and directory index for the `@orkestrel/tool` runtime.

## By concept

| Concept | Spec                         | Source                    | Tests                                 |
| ------- | ---------------------------- | ------------------------- | ------------------------------------- |
| Tool    | [`src/tool.md`](src/tool.md) | [`src/core`](../src/core) | [`tests/src/core`](../tests/src/core) |

## By directory

| Directory  | Guide                        |
| ---------- | ---------------------------- |
| `src/core` | [`src/tool.md`](src/tool.md) |

## Dependency reference

[`src/contract.md`](src/contract.md) mirrors the guide for the runtime dependency
`@orkestrel/contract`, whose total guards support the runtime's overload narrowing and
tool-call validation.

[`src/guide.md`](src/guide.md) mirrors the guide for the development dependency
`@orkestrel/guide`, which powers this repository's guide-parity tests.

[`src/scaffold.md`](src/scaffold.md) mirrors the guide for the development dependency
`@orkestrel/scaffold`, which maintains the repository scaffold.

## See also

- [`AGENTS.md`](../AGENTS.md) — the repository's coding and documentation contract.
