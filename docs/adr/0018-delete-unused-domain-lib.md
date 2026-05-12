---
status: accepted
---

# Delete the unused `libs/domain` library

## Context

ADR-0014 enumerated four sibling libraries — `common` (browser-safe shared utilities), `core` (command logic), `domain` (value types), `server` (HTTP layer) — and ADR-0017 explicitly left `libs/common` (5 files) and `libs/domain` (1 file) out of the feature-folder restructure as "below the legibility threshold."

`libs/domain` never grew past that single file: `sparql-protocol.ts` (a `SparqlFormat` union plus `SparqlRequest` / `SparqlErrorResponse` interfaces) and its spec. Nothing imported the `domain` package — the only reference to its barrel was its own spec. The types described a SPARQL HTTP wire shape that no current code path produces or consumes; they were speculative scaffolding for a server surface that was built differently (see `libs/server`).

A one-file library with no consumers is pure overhead: a `project.json`, `tsconfig.*`, `vitest.config.mts`, `eslint.config.mjs`, `package.json`, `README.md`, and a `tsconfig.base.json` path alias, all to host two unused interfaces.

## Decision

Delete `libs/domain` entirely, including `sparql-protocol.ts` and its spec — the types are unused and not worth relocating. Drop the `domain` path alias from `tsconfig.base.json`.

The sibling-lib map is now three: **`common`** (browser-safe shared types and utilities), **`core`** (command logic), **`server`** (HTTP layer). If a SPARQL wire-protocol type is needed later, it gets reintroduced where its consumer lives — in `server` if it's HTTP-layer-only, or in `common` if both the CLI and the webapp need it.

## Consequences

- **ADR-0014 partially superseded**: the "four sibling libs" framing is obsolete; the map is now three. The formatter-placement reasoning in ADR-0014 is unaffected.
- **ADR-0017's scope note** ("`libs/domain/src/lib/` (1 file) stays flat, out of scope") is moot — there is no `libs/domain`.
- **CONTEXT.md unchanged**: `domain` was a code-organization label, not a glossary term.
