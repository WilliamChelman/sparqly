---
status: partially superseded by ADR-0002
---

# Zod block schemas validate both file config and CLI overrides

The Zod block schemas in `apps/cli/src/app/config/internal/schema.ts` (`queryBlockSchema`, `serveBlockSchema`, `hashBlockSchema`, `diffBlockSchema`) are the single source of truth for the legal shape of `EffectiveOptions` per command. CLI-option adapters parse `cliOverrides` through the same block schema that validates the config file, so enum membership (`graphMode`, `format`, `mutable` coercion) is defined once.

## Considered Options

- **Hand-rolled validators in `core` (`isGraphMode`, `isSparqlFormat`) called from each command.** Rejected — the enum lists were duplicated three times (`core` const, Zod enum in `schema.ts`, hand-rolled `is*` predicate) and drift was unchecked. Also forced four near-identical "unknown --flag" blocks across the command files.
- **Move all enum runtime values into `schema.ts`.** Rejected — would invert the dependency direction (`core` would depend on `apps/cli`). Domain enums whose runtime list is meaningful to non-CLI consumers (`GRAPH_MODES`, `SUPPORTED_FORMATS`) belong in `core`.

## Consequences

- `core` exposes domain-enum runtime lists as `as const` tuples (`GRAPH_MODES`, `SUPPORTED_FORMATS`); types are derived via `(typeof TUPLE)[number]`.
- `schema.ts` consumes these tuples via `z.enum(...)` — no duplicated string lists.
- CLI-local enums with no `core` analogue (e.g. `DIFF_FORMATS` for diff output) live in `schema.ts` directly.
- Hand-rolled predicate validators (`isGraphMode`, `isSparqlFormat`, `isDiffFormat`) are removed.
- A small Zod-error → CLI-message formatter is needed to preserve the existing `error: unknown --<flag> '<v>' (expected <list>)` phrasing; that formatter is the only place CLI-specific error wording lives.
- Dependency direction stays `apps/cli → libs/core`, never reverse.
