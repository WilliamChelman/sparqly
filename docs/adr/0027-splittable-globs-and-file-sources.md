# Splittable globs and file sources

`sparqly`'s registry today treats a **Glob source** as one indivisible target: querying or diffing a single file out of a multi-file glob requires editing the project config and adding a second narrowly-scoped glob entry. The webapp picker reflects this — a glob that matches 30 files shows up as one selectable thing, and the user has no UI affordance to scope down. The stated user need is the opposite: *"easily select files in the query page or diff UI without having to touch the source config."* This ADR introduces a registry-level expansion that explodes a glob, when opted in, into the meta plus one selectable **File source** per matched file, without disturbing the single-target rule (ADR-0005) or the existing glob's semantics.

## Decision

- **New `kind: 'file'` source.** Synthesized only; never user-declared. Shape: `{ kind: 'file', id, path: string, parentId: string, transforms?: ParsedTransform[] }`. The `path` field holds the absolute resolved file path; resolution is materialized, identical to a one-file glob.
- **Opt-in via `splitByFile: true` on the parent glob.** Default is `false`. Without opt-in, glob behaviour is unchanged byte-for-byte. With opt-in, the meta retains its union-of-files semantics *and* synthesizes children.
- **Two-phase parse → expand.** `parseSourceSpecs` stays pure and synchronous — it validates shape only, including the new `splitByFile: true` flag. A separate async `expandSplitGlobs(parsed)` pass walks the filesystem, emits children, and returns a flat `ReadonlyArray<ParsedSource>`. Called once at CLI command setup and once in `createServer`, before scope/target resolution. The watcher re-runs expansion per-meta when files enter or leave a split-glob's match set.
- **Child id scheme: `<parentId>/<glob-relative-path>`.** For parent `docs` with glob `data/**/*.ttl` matching `data/people/alice.ttl`, the child id is `docs/people/alice.ttl` (relative to the wildcard portion of the glob, not the cwd). `SOURCE_ID_REGEX` is **relaxed for synthesized children only** to allow `/`; user-declared ids keep the strict regex. Child ids are stable across file additions to the meta — they depend only on the file path, not on enumeration order.
- **Route: `/api/sparql/*id` wildcard replaces `/api/sparql/:id`.** Single Nest dispatcher route that looks up the id in the current expanded registry per request. Per-id route registration is gone; no dynamic-route bookkeeping. Same dispatcher handles meta and children uniformly.
- **`SourceListingEntry` gains optional `parentId`.** Wire shape stays flat — children are peer entries alongside the meta, with `parentId` linking them. The webapp client renders the group (a collapsible "docs (4 files)" containing the meta-as-union plus its leaves) entirely client-side. The server has no concept of a tree.
- **Transform-pipeline inheritance is full and by value.** Each child receives a deep copy of the parent's `transforms:` array at expansion time. `graphName: 'forceAll'` on the parent applies identically whether the user targets the meta or one child. `annotateSource` similarly — and ADR-0008's auto-source-annotation applies to file targets uniformly with glob targets in graph-diff mode.
- **`view.from:` accepts file children.** ADR-0004's "single `@id`" rule is unchanged; the set of acceptable upstream kinds widens from `glob|endpoint|empty|view` to `glob|file|endpoint|empty|view`. Resolution is materialized for file upstreams, same as for glob.
- **Picker stays single-select on `query`/`hash`/`diff` (ADR-0005 preserved).** Multi-selecting files would synthesize an anonymous multi-target — a real semantic shift ADR-0005 closes. Users who want "files X and Y but not Z" pick the meta-as-union and add a SPARQL `VALUES ?file { ... }` clause, or declare a view.
- **No per-request file-filter axis.** File scoping is *always* expressed by targeting a child source. Adding a "restrict to these files" parameter on `/api/sparql/...` would duplicate the registry-expansion capability and create two ways to do the same thing.
- **Result-cache key for a view over a file upstream uses the absolute file path** as its `upstream-spec`, matching how the glob's pattern slots in today. Content-change invalidation is the cache strategy's job (`ttl` / `freshness` / `everlasting`), not the key's — no new cache semantics.
- **CLI discovery via documentation, not a new command.** The web UI's picker is the discovery affordance; CLI users get the id scheme documented in `CONTEXT.md` (a child is `@<parentId>/<glob-relative-path>`). Adding `sparqly sources list` is plausible follow-up scope but out of scope here.

### Shape of the new spec

```yaml
sources:
  - id: docs
    glob: 'data/**/*.ttl'
    splitByFile: true
    transforms:
      - graphName: forceAll
```

For matched files `data/foo.ttl`, `data/people/alice.ttl`, the registry after expansion contains three entries:

```
@docs                     kind: glob, glob: 'data/**/*.ttl', transforms: [...]
@docs/foo.ttl             kind: file, path: '/abs/.../data/foo.ttl', parentId: 'docs', transforms: [...]  (copy)
@docs/people/alice.ttl    kind: file, path: '/abs/.../data/people/alice.ttl', parentId: 'docs', transforms: [...]  (copy)
```

`@docs` resolves to the union (today's behaviour, unchanged); each child resolves to its single file.

### Default-marker rules

- A meta with `default: true` does **not** propagate `default` to its children. At most one default per registry; the meta-as-union is the natural default for a split glob.
- Children can never carry `default: true` themselves — they are synthesized, not declared, and the marker is configuration intent.

### Watcher integration

The existing multi-source watcher gains awareness of split-glob membership. When a file enters or leaves a meta's match set:

1. The meta's union store is re-loaded (existing behaviour).
2. `SnippetAllowList` is updated (existing behaviour).
3. The per-meta children cache is invalidated.

The next `/api/config` fetch re-expands lazily. The route layer needs no change — the wildcard dispatcher already resolves per request.

A user with the picker open does not see new files until they refresh `/api/config`. This is a deliberate v1 trade-off: a push channel (SSE / WebSocket) would tighten the loop, but at the cost of a notification surface the rest of the registry doesn't have. Polling-on-refresh keeps the surface flat and is acceptable for the affordance this ADR delivers.

## Considered alternatives

- **Served-registry-only expansion (UI-only).** Expand the glob into selectable entries in `/api/config` but leave CLI and `view.from:` unaffected. Rejected: the stated need ("select files in the diff UI") is partly fulfilled, but a user who picks `@docs/foo.ttl` in the UI cannot reproduce the same target from the CLI, and cannot wrap it in a view. The UI-server asymmetry would be a constant source of confusion.

- **UI-only file-filter axis (no synthesized sources).** Server returns a file list alongside the glob entry; client sends "restrict to these files" per request. Rejected: orthogonal new axis every query path has to honour; does not compose with `view.from:`; and the registry-expansion path already gives the same capability through one mechanism.

- **Reuse `kind: 'glob'` for children (with `parentId`).** A child would be a one-file glob with `parentId`. Tempting because every `switch (kind)` consumer already handles globs — zero exhaustiveness pressure. Rejected because a glob's identity is its pattern, and a file's identity is its path. The future direction of versioning a single file at a git revision (an idea raised during grilling) needs `{ kind: 'file', path, revision: { kind: 'git', ref } }`; you cannot graft revision identity onto a glob without breaking what a glob is. The exhaustiveness pressure from a new kind is the *right* pressure: every consumer should explicitly decide whether file semantics match glob semantics.

- **Children with no inheritance (bare files).** Parent's `transforms:` apply only when targeting the meta. Rejected: a user who wrote `graphName: 'forceAll'` on the parent meant "every triple from these files should be in graph X" — targeting one of those files should preserve that intent. Inconsistency between meta-target and child-target outputs would be more surprising than redundancy.

- **Index-based child ids (`docs.1`, `docs.2`, ...).** URL-safe and regex-clean without relaxing `SOURCE_ID_REGEX`. Rejected: ids shift when files are added or removed, breaking `view.from:` references and bookmarkable URLs. Path-derived ids are stable; relaxing the regex for *synthesized* ids only contains the blast radius.

- **Hash-stable opaque ids (`docs.a3f2b1`) with path-only labels.** Stable and URL-safe. Rejected: cryptic. CLI users typing refs would suffer; readers of `view.from:` would have no idea what file is referenced without cross-referencing.

- **Encoded child ids using `__` or another non-`/` separator.** Stays in the current regex. Rejected: ugly, and users have to learn the encoding to type a ref. The route widening (one line) is cheaper than perpetual encoding overhead.

- **Eager expansion inside `parseSourceSpecs` (single phase).** Conflates config-shape validation with filesystem I/O; every existing sync caller (tests, schema validation, dry-run paths) becomes async; config errors and I/O errors throw from the same site. Rejected in favour of the two-phase split.

- **Lazy expansion at resolution time.** Defers I/O but means `/api/config` cannot list children without resolving — defeats the picker's reason for existing.

- **Per-id Nest route registration (status quo).** Each child would register its own `/api/sparql/docs/foo.ttl` route at expansion time, with dynamic add/remove on watcher events. Rejected: dynamic route registration is more bookkeeping than the wildcard dispatcher; the wildcard pattern handles meta and children identically and lets the registry stay the single source of truth for "what ids exist now."

- **Multi-select picker on query/diff with anonymous multi-target.** Direct fulfilment of "select files" (plural) on the query page. Rejected: re-opens ADR-0005. The narrower goal — file-level scoping — is met by single-select against children, plus SPARQL `VALUES` for the rare multi-file case. If multi-select demand grows, that is a separate ADR amending 0005, not the back door of this one.

- **Push-notify listing changes via SSE.** "Live" UI without refresh. Rejected for v1: notification surface that no other part of the registry has, for an affordance (live picker) that refresh-on-demand approximates well. Reconsider if the picker grows into a long-lived dashboard.

## Consequences

- **`SOURCE_ID_REGEX` widens for synthesized children only.** User-declared ids keep the strict rule (alphanumeric, `_`, `-`, `.`; no leading dot). Children's relaxed validator accepts `/` between segments. The parser never produces a relaxed id; the expansion pass does. Tests that assert id-validation behaviour need to distinguish user-declared from synthesized.
- **`/api/sparql/:id` becomes `/api/sparql/*id`.** Existing clients that hit `/api/sparql/<bareid>` continue to work; new clients can also hit `/api/sparql/<parent>/<path>`. The route handler resolves the id in the current expanded registry and dispatches.
- **`SourceListingEntry` gains `parentId?: string`.** Backwards-compatible field add; clients that ignore it see a flat list.
- **`ParsedSource` gains the `'file'` variant.** Every `switch (src.kind)` callsite must explicitly handle `'file'`. In most consumers the body is identical to `'glob'` (the resolver, snippet allow-list, transform application, source records). In a few it differs (the eventual git-revision support, watcher granularity). This is intentional — the type system forces each consumer to decide.
- **`parseSourceSpecs` stays sync and pure.** All existing callers continue to work. The new `expandSplitGlobs` is called explicitly by the two top-level setup paths (CLI command init, `createServer`) and the watcher.
- **Picker UX: meta is the default-selected entry** of a split-glob group when the user lands on the page. Children are *additional* affordances, not the new default.
- **Cache keys for file upstreams need no new code paths** — `upstream-spec` is the absolute file path, slotting into the existing key shape. Existing strategies (`ttl`, `freshness`, `everlasting`) apply unchanged.
- **CLI discovery is by documentation, not introspection.** `CONTEXT.md`'s **File source** and **Split glob** entries describe the id-derivation rule. Power-users hand-construct child ids from the filesystem they already know. A `sparqly sources list` command may follow; it is not blocked by this ADR but does not ship with it.
- **ADRs amended (not superseded):**
  - ADR-0004 — upstream kinds widen to include `file`.
  - ADR-0005 — file children are valid single-targets; multi-file scoping remains out of scope.
  - ADR-0006 — split-glob children inherit the transform pipeline by value.
  - ADR-0008 — auto source annotation applies to file targets uniformly.
