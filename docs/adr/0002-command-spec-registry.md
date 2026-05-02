---
status: accepted (partially supersedes ADR-0001)
---

# CLI commands are self-describing specs in a registry

Each CLI command is a value (a "command spec") in a registry, composed from reusable field descriptors that own a field's `schema + default + flag(s) + env` in a single declaration. The runner walks the registry to derive Commander subcommands, the file-config schema, the env reader, and the layer-merge logic — replacing the per-command `switch (command)` dispatches in `schema.ts`, `effective.ts`, and `cli-errors.ts` and the monolithic `EffectiveOptions` bag with per-command typed config.

## Considered Options

- **Keep the monolithic `EffectiveOptions` and the per-command `switch` statements; just clean up `cli-errors.ts`.** Rejected — the smell is "implicit shared shape that pretends to be the same across commands but isn't really". Most fields are `undefined` for any given command; every command re-validates its required fields in code. Cleaning the symptoms doesn't fix the structure.
- **Inject universal flags (`--verbose`, `--quiet`, `-o`) implicitly via the runner; commands declare only their domain-specific schema.** Rejected — auto-merging fields the command didn't declare reintroduces the same implicit shape problem the refactor exists to remove. Universal flags are spread from a `verbosityFields` / `outField` bundle that each spec explicitly composes. Carve-out: `--config` and `--print-config` are runner-owned (parsed before dispatch) since they are meta-flags that decide *whether* the command runs at all, not command inputs.
- **Pure handlers returning `CommandResult = { stdout, stderr, files, exitCode }`.** Rejected — `serve` is long-running and `format --write` writes per-file; both need streaming I/O. Forcing them into a returned-value shape creates a discriminated union that is just port-injection wearing a hat. Handlers stay `(config: TConfig) => Promise<void>` and write to `process.stdout`/`process.stderr` directly; on `throw`, the runner maps the error via `spec.exitCode(err)` and writes the `error: ...` line. Handler bodies stop mutating `process.exitCode`.
- **Inject ports (`stdout`, `stderr`, `fs`) into handlers for in-memory testability.** Deferred — testability was not the load-bearing pain. The signature `(config) => Promise<void>` → `(config, ports) => Promise<number | void>` is an additive refactor once the registry exists.
- **Generate nest-commander classes from specs (keep the framework as a thin shim).** Rejected — no command currently uses constructor injection; `AppModule.providers` is a glorified list; programmatic decorator application would fight nest-commander to satisfy a runtime that adds no value. The CLI uses Commander directly (which `nest-commander` already wraps internally).
- **Hand-roll argv parsing.** Rejected — re-implementing `--help`, subcommand routing, and required-positional validation is unpaid work. Commander handles all of it.

## Consequences

- **Field descriptors own a field's full CLI surface.** A field is declared once with `key + schema + default + flag(s) + env`. Touching `--graph-mode` becomes a single-file edit. `cli-errors.ts:FIELD_TO_FLAG` is derived from the registry.
- **Adapters dissolve.** The per-command `*.adapter.ts` files collapse into one runner step: `spec.schema.safeParse(rawCli)`. The `*.adapter.spec.ts` files transform into spec-validation tests.
- **No `switch (command)`.** `defaultsFor`, `blockKeysFor`, `blockSchemaFor`, the `LAYERS` block-reader, and `exitCodeFor` collapse into iterators over the registry. Adding a command is "write a spec, register it" — no edits to shared dispatch.
- **File config schema is derived and per-command.** Each spec's file-config schema is `blockSchemaFromFields(spec.fields)`, marked `.strict()`. The file is flat — no `extends:`, no shared block, no per-command blocks; `CommandSpec.fileBlockName` and `FieldDescriptor.shared` are gone. Unknown keys are hard validation errors. Documented filename convention: `sparqly.<command>.{yaml,yml,json}` (e.g. `sparqly.query.yaml`); the runner does not enforce it.
- **Config files load only on demand.** No filesystem walk / auto-discovery. The runner loads a config file only when `--config <path>` is passed or `SPARQLY_CONFIG` is set in the environment; `--config` wins. A missing or unparseable path is a hard error. Cosmiconfig is gone — extension-dispatched `js-yaml` (`.yaml`/`.yml`) and `JSON.parse` (`.json`) handle parsing.
- **`extends:` deferred.** Sharing defaults across per-command files is left out until a real use case appears.
- **Layer participation is implicit.** A field is CLI-readable iff it declares `flag`, env-readable iff it declares `env`, file-readable always, default-applied iff it declares `default`. No separate `sources: [...]` declaration on descriptors.
- **Universal flags are explicit composition.** `--verbose / --quiet / -o` come from a shared field bundle each spec spreads; `--config / --print-config` are runner-owned and never appear in any spec's schema.
- **Positionals are spec-level metadata.** A spec declares `positionals: [{ field, name, required?, variadic? }]`. The runner reads positionals into the same field-keyed bag that flags write to; flag value wins on conflict.
- **Multi-flag aliases handled per-flag.** `--immutable`'s `parse` writes the inverted boolean to `mutable` directly. `mutableFromCli` is removed. If a future field needs cross-flag derivation, a `derive(raw)` hook can be added then.
- **Exit codes belong to the spec.** Each spec declares `exitCode(error: unknown): number` (defaults to 1; `diff` returns 2; `hash` distinguishes mismatch from error). Handlers throw; the runner maps once.
- **Drop `nest-commander` and `AppModule`; keep `@nestjs/common` `Logger`.** Apps/cli `package.json` loses `nest-commander`. `apps/cli/src/main.ts` builds a Commander program from the registry. `Logger` is preserved to avoid a parallel logger abstraction.
- **ADR-0001 is partially superseded.** Zod is still the validator, and `core` still owns domain enum tuples (`GRAPH_MODES`, `SUPPORTED_FORMATS`); but per-command block schemas are no longer assembled in `schema.ts` — they are computed from `spec.fields` by the runner.
