# HTML diff format with source-file snippets

## Context

ADR-0006 introduced **Source records** (file, line) on glob-source triples via the `annotate` transform, but `diff` discards them — the CLI calls `canonicalizeStore` per side directly and never plumbs `diffStores`'s per-side `sourceRecords` map into output. The line numbers users paid for at load time are invisible in the diff. The motivating use case is "jump from a diff hunk to the source," which needs both the (file, line) reference and, ideally, enough context to compare against an open IDE without loading every file by hand.

## Decision

Surface **Source records** in every existing diff format, in the format-specific natural slot, and add a new `html` format that additionally embeds **Source-file snippets** read from disk at render time.

### Per-format augmentation

- **`json`** — each `added`/`removed` entry gains an optional `sourceRecords?: { file: string; line?: number }[]`, populated from the canonical side (right for `added`, left for `removed`). Top-level shape unchanged.
- **`human`** — inline trailing comment, paths displayed relative to CWD, per-file line compression: `+ <:s> <:p> <:o> .  # data/foo.ttl:5,12; data/bar.ttl:3`.
- **`rdf-patch`** — same trailing-comment shape as `human` (RDF Patch spec permits `#` comments to end-of-line).
- **`turtle`** — flatten to one statement per line in diff output (do not group by subject with `;`/`,`), with `# from <path>:<line>` immediately above each. Prefix declarations remain at the top of each `# --- removed/added ---` block. The diff turtle renderer diverges from `formatRdf`'s grouping behavior.
- **`html`** *(new)* — single self-contained file (no JS, inline CSS), unified `removed` then `added` list (matching the other formats' shape), plus a **Source-file snippet** per record: `<pre>` block with line-numbered gutter, focal line highlighted, `--context N` (default 3, max 100) lines around it. Per-record snippets in source-record order; cap at 10 with `<details>` collapse for the rest. Files unreadable at render time degrade to a `(source file unavailable)` note. Path display is relative to CWD; link `href` is absolute. Anchor IDs (`id="<path>-L5"`) emitted for future deep-linking.

### CLI flags

- `-C, --context N` — html only; errors loud on non-html formats; warns on stderr when no source records exist; default `3`, max `100`.
- No file-size cap on snippet reading; no cross-format suppression flag; no editor-URI template (deferred).

### Degraded behavior

Sources without `annotate`, view targets, and endpoint targets all produce *no* source records (annotations don't propagate through views per ADR-0006; endpoints can't carry RDF-star annotation triples through pass-through). In those cases:

- Other formats: byte-identical to today.
- `html`: stderr warning (`note: no source records present; HTML output will contain no line numbers`), still emits valid HTML.
- Mixed (one side annotated, other not): unconditional stderr summary line (`note: source records present on left only — right side hunks will not be annotated`), suppressible with the existing `--quiet`.

### Determinism trade-off

Other formats remain content-deterministic — re-running `diff -f json` after editing a source file produces an unchanged result if the canonicalized diff is unchanged. `html` is *not* content-deterministic: it embeds source-file content at render time, so editing a file between two `diff -f html` invocations changes the document even when the canonicalized diff is identical. This asymmetry is deliberate — the side-by-side IDE workflow that motivates HTML output requires reading the live file.

## Considered alternatives

- **Sidecar `sourceRecords` map at the json top level** (mirroring `RdfDiffWithSourcesResult` exactly) — rejected: forces every consumer to do a join their per-entry use case never needs.
- **Group turtle output by subject and aggregate source records into a single comment block per group** — rejected: silently loses per-(s,p,o) precision that the user paid for; HTML would have the same precision while turtle wouldn't, an inconsistency.
- **Skip `rdf-patch` from augmentation** to keep it strictly machine-shaped — rejected: creates a surprising hole in the "all formats augmented" contract; spec-allowed `#` comments are universally tolerated by patch parsers.
- **HTML embedding source snippets only via hyperlink, not inline** — rejected: defeats the "compare against an open IDE without loading every file by hand" goal; users explicitly asked for inline context.
- **Snapshot source-file content into the diff result at canonicalization time** to keep `html` content-deterministic — rejected: large memory cost on real ontology repos; the user accepted the determinism trade-off for the navigation payoff.
- **Configurable `--max-source-file-bytes` cap on snippet reading** — rejected: in practice users diffing TTL repos don't hit pathological file sizes, and a flag for a non-problem is gratuitous configurability. Implementation should still stream-read up to `max(line + context)` to avoid pathological multi-GB reads.

## Consequences

- The CLI `diff` command switches from `canonicalizeStore`-per-side to `diffStores` to obtain the per-side source-record map; a small extra cost on non-annotated sources (loop over zero annotation triples returns immediately).
- The turtle diff renderer diverges from `formatRdf` grouping; this divergence is local to `diff` and does not affect `query`/`serve`/`format`.
- `html` is the first sparqly output that reads the filesystem at render time. Future formats inherit the precedent — adding e.g. `markdown` later with snippet embedding is unsurprising; adding it without snippet embedding now becomes the surprising choice.
- The `--context` flag is the first format-specific flag on `diff`; until now all flags were either cross-format or scoped to a side. Naming convention going forward: format-specific flags are loud-error on the wrong format, never silently ignored.
