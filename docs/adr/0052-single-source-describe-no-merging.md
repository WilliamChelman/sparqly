---
status: accepted
supersedes: 0025, 0033
amends: 0015
---

# Single-source describe, no cross-source merging

## Context

ADR-0015 made the describe page's headline UX a *merged* view across the whole
served registry, and ADR-0033 cemented that ("omitted source = all, merged") while
explicitly rejecting "default to the registry's default source." In practice the
merge machinery — per-quad **Describe provenance** (`urn:sparqly:fromSource`
inject/strip), `originsByQuad`, per-source UI badges, per-source error display, and
the best-effort multi-origin error contract of ADR-0025 — is a large surface that
isn't earning its keep, and "describe is about one source" is a cleaner mental model
that matches `query`/`diff`.

## Decision

Describe targets exactly one source. The describe page swaps its single-or-cleared
picker for the mandatory single-select picker used by `query`/`diff`: it auto-selects
the **default source** on landing, falling back to the first listed source when none
is marked default, and offers no cleared/all state. On the wire, `source` stays
optional; an omitted `source` resolves server-side to the **default source** (reusing
the ADR-0016 default-routing already behind `/api/sparql`).

All cross-source merge machinery is deleted: **Describe provenance** (inject/strip,
the `withProvenance` flag, the config-exposed predicate), `originsByQuad`, source
badges, and per-source error display. The response flattens to
`{ iri, quads, total, truncated }`; a source that fails to describe errors the
top-level `Result` per ADR-0024, retiring ADR-0025's deliberate best-effort deviation.
The annotate-source transform's RDF-star machinery is untouched (it never shared code
with describe provenance). Per-source bnode relabeling is retained for now because
ADR-0019 UI-driven expansion may rely on stable bnode labels to stitch slices.

## Considered alternatives

- **Keep merge, hide it behind a toggle.** Rejected: keeps every line of the
  machinery we're trying to delete.
- **Make `source` required on the wire.** Rejected: the describe-this affordance
  benefits from being able to omit it and let the server pick the default.
- **Keep provenance plumbing dormant for a future merge.** Rejected: a config field
  and wire flag that nothing reads; merge returns with its own ADR if ever.
