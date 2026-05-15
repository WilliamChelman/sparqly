# Implicit `annotateSource` for diff, opt-out via flag

## Context

ADR-0006 made the `annotate` transform an explicit opt-in on glob sources, declared under `transforms:` in config. ADR-0007 then built the `html` diff format around the source records that transform produces. The two ADRs together created an awkward CLI seam: the natural one-shot invocation `sparqly diff --left=a.ttl --right=b.ttl --format=html --out=report.html` produces a degenerate HTML output (no line numbers, no source-file snippets) because inline glob targets have no place to attach a transform. The stderr warning "no source records present; HTML output will contain no line numbers" was a workaround for the very gap users were hitting; not a fix.

## Decision

`diff` defaults to **auto source annotation**: it implicitly prepends `annotateSource` to the transform pipeline of every glob target it loads, inline or declared. An explicit `annotateSource` declaration in config wins (no double-apply; custom predicate IRIs preserved). The flag `--skip-auto-source-annotation` opts out the implicit injection only — explicit declarations still run when the flag is set, so users with custom predicate IRIs keep the behavior they configured.

The transform is renamed `annotate` → `annotateSource` at the same time (pre-1.0 hard rename, no compat shim). The new name disambiguates from future "annotate-by-X" transforms (inference, SHACL, lineage, etc.) where source-file provenance is just one annotation flavor.

The default flip is **scoped to `diff` only**. `query`, `serve`, `format`, and `hash` keep `annotateSource` as explicit-opt-in:

- `hash` strips annotations during canonicalization — auto-annotating would waste load-time work for zero output change.
- `query` and `serve` would ship larger in-memory stores and surface RDF-star quoted triples to clients that didn't ask for them.
- `format` would silently inject RDF-star into round-trip output, breaking the obvious "parse then re-serialize" mental model that users rely on.

## Considered alternatives

- **Source-level default (D2)** — make every glob source carry `annotateSource` by default for *all* commands. Rejected: breaks `format`'s round-trip identity and inflates `query`/`serve` results, in exchange for a benefit only `diff` consumes.
- **Hybrid auto-on (C from grilling)** — auto-annotate inline globs only, leave declared sources as explicit-opt-in. Rejected: creates an unprincipled asymmetry between `--left=path.ttl` and `--left=@my-glob` for users who have configs.
- **Explicit `--annotate` flag (B)** — keep transforms fully opt-in, add a CLI flag. Rejected: the flag would be on 95% of the time; defaults should match the common case.
- **Skip implicit injection if user declared *any* transforms (G3)** — Rejected: a user who wrote `transforms: [{ graphName: 'forceAll' }]` did not say "no annotation"; they said "force the default graph." Coupling unrelated transforms to the annotation default is a footgun. The way to opt out is the explicit flag.
- **Hard opt-out (E1) — `--skip-auto-source-annotation` suppresses both implicit and explicit `annotateSource`**. Rejected in favor of E2: the flag name `--skip-*auto*-source-annotation` reads as "skip the *automatic* part," matching the soft-opt-out semantics. Users with custom predicates get to keep them on flagged runs.
- **Append `annotateSource` to the pipeline (G2)** instead of prepend. Rejected: source provenance is foundational metadata; conceptually it belongs at the head of the pipeline. Today the orderings produce identical results (annotation triples are graph-agnostic RDF-star, untouched by `graphName`), but G1 is the more defensible default for any future transform that rewrites or removes asserted triples.
- **Dual-accept rename (F2)** — both `annotate` and `annotateSource` parse, with deprecation warning. Rejected: pre-1.0 with no external consumers; compat code would be written and deleted in the same release window.

## Consequences

- **Amends ADR-0006**: the "transforms are explicit-opt-in" stance now has one carve-out — `diff` may inject `annotateSource` implicitly. The carve-out is per-command, not per-transform, so the philosophy holds for every other transform and every other command.
- **Amends ADR-0007**: the stderr warning "no source records present; HTML output will contain no line numbers" shifts meaning. Pre-decision it fired in the common case (user didn't know about `annotate`); post-decision it fires only when the user actively passes `--skip-auto-source-annotation` against a non-`html` flow, or runs `diff` against a view/endpoint target where annotations can't propagate. The mixed-sides note ("source records present on left only") similarly becomes a rarer signal.
- **Breaking config rename** — any existing config using `transforms: [{ annotate: ... }]` must migrate to `annotateSource`. Zod's closed-key validation produces an `unrecognized key` error pointing at the offending position; we accept that error UX rather than ship a hint refinement.
- **`html` diff output is now line-number-rich by default** for the common inline-glob CLI use case. The "feature works without ceremony" is the whole point of the ADR.
- **Sets precedent for command-scoped implicit transforms.** Future commands with output formats that depend on a transform may inject it the same way (e.g. a hypothetical SHACL-aware diff format injecting a SHACL-validation transform). The pattern: implicit prepend, explicit declaration wins, `--skip-auto-<transform-name>` flag for opt-out.

## Amendment — ADR-0027 (split globs)

`diff`'s implicit `annotateSource` injection applies uniformly to **File source** targets (split-glob children) and to **Glob source** targets in **graph-diff** mode. A `diff` between two children of the same split glob — or between a child and any other glob/file target — produces source records on both sides, so per-file URIs disambiguate which side a record came from. The opt-out flag `--skip-auto-source-annotation` and the explicit-wins rule behave identically whether the target is a meta or a child.
