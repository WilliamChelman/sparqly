---
status: accepted
---

# Source admin actions as a capability flag distinct from saved-query writability

## Context

ADR-0036 introduced the first capability flag on `/api/config` —
`savedQueries.writable: boolean`, driven by `serve --read-only`, gating writes
to the **Saved-query sidecar**. The new **Sources page** (CONTEXT.md) needs to
gate a second, *different* class of mutation: per-entry **Load now**,
**Reload**, **Unload**, **(Re)build index**, **Cancel build**, and **Test
connection**. None of these touch project files — they consume server
resources (CPU, RAM, disk for the **Glob index**, network for the endpoint
probe) and mutate `serve`'s in-process registry state.

The motivating deployment scenario is a public or shared `serve` behind a
reverse proxy where anonymous visitors should be able to *query* the served
registry but must not be able to kick off a multi-GB index rebuild or unload
a hot in-memory source on a whim. `serve --read-only` is the existing switch
operators reach for in that scenario; the question is whether to fold source
admin actions under the same single flag or split.

## Decision

- **Add a second capability flag, `sources.allowAdminActions: boolean`, to
  the `/api/config` envelope.** Defaulted from the same `serve --read-only`
  switch as `savedQueries.writable` — there is one operator-facing switch,
  two named flags downstream.
- **When `false`, the webapp hides every Sources page action affordance
  and the corresponding API routes (`POST /api/sources/:id/{load,
  reload, unload, index-build, test-connection}`, `DELETE
  /api/sources/:id/index-build`) reject with `403 Forbidden`.** The
  snapshot endpoint (`GET /api/sources`) and the SSE stream (ADR-0044)
  remain readable — viewing state is not a privileged action.
- **The flag does not affect auto-trigger semantics.** A disk-backed
  glob's first-query-touch background build (ADR-0031 / ADR-0041) keeps
  running regardless of the flag, because otherwise a disk-backed source
  becomes permanently unqueryable on a read-only `serve` — the exact
  failure ADR-0031 exists to avoid. The flag gates only operator-initiated
  Sources-page actions.

## Considered options

- **Reuse `savedQueries.writable` as the single flag for both classes.**
  Rejected. The two mutation classes are genuinely different: saved-query
  writes touch a hand-authorable project file (where the operator's worry
  is "is my YAML being edited under me?"), source admin actions consume
  server resources (where the operator's worry is "is a visitor going to
  spawn a 15-minute index rebuild?"). Conflating them means any later
  deployment that wants one without the other (e.g. team-share saved
  queries on a public viewer; admin actions on a private internal `serve`
  with operator-only saved queries) has no path forward without a
  breaking-change rename. Two flags now is cheap; one flag now is
  expensive to undo.
- **Always allow, never gate.** Rejected. The presence of the
  `--read-only` switch on `serve` already declares that operators expect a
  multi-audience deployment posture; ignoring that posture for the new,
  more-expensive action class would be a surprising regression of the
  read-only contract.
- **Per-action flags (e.g. `sources.allowRebuild`, `sources.allowUnload`).**
  Rejected as premature. The motivating distinction is between *reading*
  source state and *issuing* mutating actions; sub-distinctions between
  the actions themselves haven't shown up as a real use case yet, and the
  flag namespace can be extended additively if one ever does.

## Consequences

- The webapp's boot-time `/api/config` fetch now reads two capability
  flags rather than one. The capability mechanism stays a config-level
  fact, not a runtime probe (per ADR-0036's "no `/api/capabilities`
  endpoint" rationale).
- Operators who want asymmetric capabilities (e.g. read-only saved queries
  + admin actions enabled, or vice versa) can override one flag in the
  project config without lifting `--read-only`; the CLI switch sets the
  default, the config refines it.
- This ADR sets a pattern: future writable webapp surfaces (e.g. the
  config-edit UI in `ideas.md`) should expect to add their own
  `*.writable` / `*.allow*` flag on `/api/config` rather than reusing one
  of the existing flags.
