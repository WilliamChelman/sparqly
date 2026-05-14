# Empty glob match warns instead of errors

`sparqly` today fails a load when a glob matches zero files: `rdf-loader.ts:48` throws `GlobLoadError` with `"No files matched sources: <glob>"`. The behaviour predates **registry expansion** (ADR-0027) and was a reasonable typo-protection default at the time — a misspelled glob would never silently produce empty output. With ADR-0027 introducing **split globs** that walk the filesystem at registry-construction time, a zero-match glob is no longer just a query-time concern: it is a registry-construction concern too. Keeping the loud-failure default would mean a brand-new project with no data files yet cannot even start `sparqly serve`; an in-progress project where a directory has been emptied breaks all consumers until something is dropped back into it. The trade-off has shifted, and this ADR flips it.

## Decision

- **Empty glob matches warn, not error, in both load and registry-expansion paths.** A glob — declared or split — that matches zero files yields an empty store (or, for a split glob, an empty children list alongside the meta entry) and emits one `warn`-level log line through the existing `SparqlyLogger` boundary (ADR-0020).
- **One warning per glob per load.** Repeating the same warning across each consumer of an empty glob is noise. The warn fires once, at the place that did the filesystem walk: `loadRdfResult` (or its split-glob equivalent).
- **The warning identifies the glob pattern and the absolute base path that was searched.** A user reading the log should be able to reproduce the walk with `ls` or `fd` and confirm there really are no files there.
- **Resolution proceeds with an empty store.** Downstream consumers — view query execution, `hash`, `diff`, `describe`, `serve` listing — operate on the empty store unchanged. `diff` of two empty sides yields an empty diff. `hash` of empty canonicalises to an empty N-Quads serialization (a stable, known-empty hash). No special "empty target" case is needed at any consumer.
- **The `GlobLoadError` type stays.** Other filesystem failures — permission denied, IO error, malformed RDF — continue to error. Only the *no-match* branch of `loadRdfResult` flips.

## Considered alternatives

- **Status quo — error on zero match.** Loud typo detection at the cost of zero-data starts. Rejected: split globs make zero-match a common transient state (creating the project, clearing a directory to repopulate it, the brief window during a watcher-detected rename). A loud failure makes `serve` and the webapp picker unusable in those states.
- **Per-source `requireFiles: true` opt-in to restore loud failure.** Surface-area cost (new field, validation, documentation) for a knob nobody asked for. Rejected: typo detection has cheaper alternatives — `sparqly serve` logs the warning at startup with the searched path; a follow-up `sparqly sources list` (mentioned in ADR-0027 as plausible scope) would surface zero-match metas as part of normal introspection.
- **Warn at every consumer.** A view over an empty glob, queried 10 times, produces 10 warnings. Rejected: noise. The warning belongs at the load site, where the filesystem walk happens once.
- **Convert to a structured `empty-glob` warning in the typed-error system (ADR-0024).** Tempting because the codebase has a typed-error discipline. Rejected: ADR-0024 is for *errors* — outcomes that abort a flow. An empty match no longer aborts; it is informational. The right channel is the boundary logger, not the error channel.
- **Treat empty glob as an error only for the *target* of a command, not for intermediate `from:` chains or split-glob registry construction.** Inconsistent — same condition, different verdict depending on position in a chain. Rejected: the simpler rule (always warn) is easier to teach and easier to predict.

## Consequences

- **Behaviour change for existing users of plain globs.** A user who today relied on the loud failure to catch a typo will, after this change, see an empty result with a warn line. Mitigation: the warn line names the glob and the searched path; `sparqly serve`'s startup log surfaces it where users are looking; the typed-error contract for *other* glob failures is unchanged.
- **`rdf-loader.ts:48` flips from `errAsync(GlobLoadError)` to a successful empty-store `Result` plus one `logger.warn` call.** The function's `ResultAsync<LoadResult, GlobLoadError>` signature stays — `GlobLoadError` remains for the non-empty-match failure cases.
- **Registry expansion (ADR-0027) uses the same warn path** for a split glob with zero matches: the meta enters the registry, no children are synthesized, the warning fires once.
- **Tests asserting the loud-failure error behaviour for zero-match globs are updated** to assert the warn-and-empty-store behaviour instead. The error-branch tests for *other* `GlobLoadError` cases (e.g. malformed-RDF surfaces) are unaffected.
- **`hash` and `diff` on an empty-glob target produce empty-but-valid output.** Empty N-Quads canonicalises to a stable known hash; an empty-vs-empty diff is empty. No new edge cases introduced at the canonicalisation or diff layers.
- **`CONTEXT.md`'s **Glob source** and **Split glob** entries pick up a one-line note: empty matches warn, not error.**
