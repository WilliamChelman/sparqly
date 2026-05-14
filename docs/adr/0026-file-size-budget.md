# File-size budget: soft 300, hard 500

Long source files cost reviewers and coding agents alike: an 800-line file mixing four concerns forces a full scroll to follow a one-concept change, and an `explorer` subagent that pulls the whole buffer pollutes context with three concerns it did not need. ADR-0017 codified *where* files live (feature folders, barrels, promotion); this ADR codifies *how big they get*. The numbers are anchored to observed shape — the median non-test `.ts` file in this repo is **65 lines**, p75 is **131**, p90 is **269**; only **17 files exceed 300**, **12 exceed 400**, and **3 exceed 500** at the time this ADR is written. A budget that lands well above p90 is a ceiling on outliers, not a default.

## Decision

- **Soft target: 300 lines.** Review-time prompt, not enforced. A file above 300 should answer "what would the split look like?" — sometimes the answer is "one cohesive thing, leave it"; the review just makes the question explicit.
- **Hard ceiling: 500 lines.** Enforced by ESLint `max-lines` (see snippet). New files cannot land above 500 without an explicit, reviewable override entry.
- **Responsibility heuristic.** A file names one concept. Co-located helpers must be (i) used only by that concept and (ii) under ~50 lines combined. Past that, extract — either to a sibling within the same feature folder (preferred) or to `shared/` if genuinely orthogonal (ADR-0017's promotion rule applies).
- **Spec/fixture exemption.** `*.spec.ts`, `*.golden.spec.ts`, anything under `test/` or `__fixtures__/` or `dist/`, are exempt. There is **no exemption for "types-only" files** — types co-locate with the function they describe (see #257 keeping `Hunk`, `HunkLine`, `HunkedRdfDiff` next to `groupRdfDiffByEntity`).

### Lint shape

```js
{
  files: ['**/*.ts'],
  rules: {
    'max-lines': [
      'error',
      { max: 500, skipBlankLines: true, skipComments: false },
    ],
  },
},
{
  files: [
    '**/*.spec.ts',
    '**/*.golden.spec.ts',
    '**/test/**',
    '**/__fixtures__/**',
    '**/dist/**',
  ],
  rules: { 'max-lines': 'off' },
},
// Grandfathered offenders — sweep PRs delete entries from this list.
{
  files: [
    '**/lib/bootstrap/create-server.ts',
    '**/lib/formatter.ts',
    '**/lib/sources/source-spec.ts',
  ],
  rules: { 'max-lines': 'off' },
},
```

`skipBlankLines: true` matches ESLint's default; `skipComments: false` is deliberate — a 600-line file half-commented-out is still 600 lines a reader has to scroll past.

### Override-list discipline

Grandfathered offenders live in **one block in `eslint.config.mjs`**, not as per-file `// eslint-disable max-lines` comments. Two reasons:

- The migration backlog is visible in one place; `git diff` on the config tells reviewers "this PR shrinks the backlog."
- A scattered `// eslint-disable` is invisible to the next contributor opening the file — they have no signal that the file is in violation of a rule.

Patterns use trailing-segment globs (`**/lib/...`) so they resolve whether ESLint runs from the repo root or from an Nx project root.

### Sweep policy

The override list shrinks to zero through deterministic **sweep PRs**, not next-touch attrition:

- One sweep PR per remaining offender (or per small cluster sharing a feature). Each sweep PR:
  - Splits the offender along the responsibility heuristic.
  - Removes the corresponding entry from the override block.
  - Keeps the public surface byte-identical (cross-folder consumers should not have to follow).
  - Cites this ADR and the issue tracking the parent migration.
- The override block deletes when empty. The lint rule then applies uniformly.

Next-touch attrition was rejected: offenders that nobody touches stay long forever, and the migration timeline depends on unrelated feature work. Sweeps make the deadline a function of intent rather than incident.

### Escape-hatch policy

A file that legitimately exceeds 500 lines — one cohesive algorithm, generated code, a serialization codec where splitting harms locality — earns an override entry, not a `// eslint-disable` comment. The PR adding the entry must:

- Justify why splitting would harm the file's responsibility shape (not "this would be annoying to split").
- Reference an ADR if the rationale generalises, or document the rationale in the override block as a comment if it is file-specific.

This keeps the escape hatch reviewable — the override block is the single place to ask "why is this still here?"

### Worked examples

This ADR crystallises after two splits validated the heuristic against real code:

- **#256** — `apps/cli/src/app/commands/diff.ts` (873 lines) split into a six-sibling `apps/cli/src/app/commands/diff/` folder. The split surfaces five real concerns (entry + field descriptors + cross-flag validation + side resolution + graph runner + tabular runner) that were previously interleaved. Each sibling lands well under 300; the override entry for `diff.ts` was deleted in the same PR. The split also motivated the ADR-0017 amendment (a command may be one file *or one folder*) — see ADR-0017.
- **#257** — `libs/core/src/lib/diff/group-rdf-diff-by-entity.ts` (838 lines) split into four siblings within the existing `diff/` feature folder. The entry retains `Hunk`, `HunkLine`, `HunkedRdfDiff` and `groupRdfDiffByEntity` — types stay with the function they describe — and the new siblings cover anchor resolution, subject-path construction, RDF-list compaction, and line ordering. No new sub-folder, no new barrel: ADR-0017's "subdivide on demand" rule applies, and a four-sibling cluster is not yet a sub-folder. Override entry deleted in the same PR.

Both splits were byte-identical refactors — existing golden tests passed unchanged. That is the standard for sweep PRs.

## Considered alternatives

- **Soft 200 / hard 400.** Closer to median (65) but well below p90 (269). Several legitimately cohesive files (e.g. `view-cache.ts` at 491, `diff.ts` at 489, `view-resolver.ts` at 403) would either need pre-emptive splitting or permanent overrides. 300/500 absorbs the existing shape without grandfathering half the codebase.
- **Hard ceiling only, no soft target.** Rejected: a 499-line file would land silently. The soft target exists to make the *review* ask the split question even when lint stays quiet. The cost is one sentence in this ADR; the value is review-time prompting on the long tail.
- **Per-file `// eslint-disable max-lines` instead of an override block.** Rejected for the visibility reason above. The override block is the migration backlog; per-file disables hide it.
- **Next-touch attrition for the migration.** Rejected: the timeline becomes a function of feature work, not intent. Sweep PRs let the backlog drain on a known schedule and keep each PR focused on one structural change.
- **Exempt "types-only" files.** Rejected: types-only files are a code smell more often than a real category. Public types co-locate with the function they describe (validated by #257). A 500-line types file is almost always a sign that the feature underneath wants splitting.
- **Count tokens or characters instead of lines.** Rejected: lines are what reviewers see, what `wc -l` reports, and what ESLint already counts. Tokens would be a sharper metric for AI context but a worse one for the primary audience (humans reviewing PRs).

## Consequences

- **Lint enforces 500 from now on.** New code cannot regress; the override block is the only escape.
- **Three grandfathered offenders remain** as of this writing: `bootstrap/create-server.ts` (678), `common/formatter.ts` (615), `sources/source-spec.ts` (556). Each gets a sweep PR per the parent migration; the override block deletes when empty.
- **The soft target shapes review.** Reviewers can point at the 300 line and ask "what's the split?" without needing to invoke this ADR each time.
- **`*.spec.ts` files stay unbounded.** Test setup is allowed to be verbose; the budget targets production code where readers pay the cost.
- **Coding agents benefit downstream.** Files under 500 lines fit comfortably in context; the `explorer` subagent has finer-grained slices to read. `CLAUDE.md`'s "Agent navigation" section codifies the workflow (barrels first, `explorer` for ≥400-line files).
- **No public surface change.** This is policy + lint config; no runtime, HTTP, or CLI behaviour moves.
