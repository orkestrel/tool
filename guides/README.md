# Guides

The concept and directory index for the `@orkestrel/tool` runtime. One concept, one guide: the
tool — JSON-Schema-described callable functions and the registry that advertises and executes
them.

## By concept

| Concept | Spec                 | Source                    | Tests                                 |
| ------- | -------------------- | ------------------------- | ------------------------------------- |
| Tool    | [`tool.md`](tool.md) | [`src/core`](../src/core) | [`tests/src/core`](../tests/src/core) |

## By directory

| Directory  | Guide                |
| ---------- | -------------------- |
| `src/core` | [`tool.md`](tool.md) |

## Dependency reference

These mirror the guides of packages this repository consumes; they document those packages, not
this one.

[`contract.md`](contract.md) — the runtime dependency `@orkestrel/contract`, whose total
guards back the runtime's overload narrowing and tool-call validation.

[`guide.md`](guide.md) — the development dependency `@orkestrel/guide`, which powers this
repository's guide-parity tests.

[`scaffold.md`](scaffold.md) — the development dependency `@orkestrel/scaffold`, which
maintains the repository scaffold.

## See also

- [`AGENTS.md`](../AGENTS.md) — the repository's coding and documentation contract.
