---
status: accepted
---

# Webapp-mutable saved-query sidecar with optimistic concurrency

## Context

`sparqly serve` exposes a registry-aware webapp (ADR-0011) whose contract has been **read-only with respect to project files**: the server reads `sparqly.config.yaml` (and ancillaries like view query files) and answers HTTP requests; nothing the user does in the browser changes anything on disk. That invariant has carried a lot of weight — it is the reason `serve` can run safely against a checked-out git worktree, against a CI artifact, behind a public-facing reverse proxy, or across multiple browsers/tabs without concurrency machinery.

The new **Saved query** feature (CONTEXT.md) is the first surface that needs to write back. Users save SPARQL queries (templated and not) from the webapp's editor surfaces (the `query` page; both sides of the `diff` page), expect those saves to survive page reloads and be shareable with teammates, and — for **Templated saved query** authoring — expect to fill in the `parameters:` block from a UI pane, not by hand-editing YAML in a terminal.

A purely browser-local persistence (localStorage / IndexedDB) was the obvious low-risk option but was rejected upstream of this ADR — the team-share value prop is the headline win, and a single-browser store can't deliver it. That leaves server-side persistence, which forces decisions on: *where* on disk, *what format*, *what concurrency model*, *what read-only story*. This ADR captures those.

## Decision

- **The webapp writes to a separate YAML sidecar, not into the main project config.** Default discovery: `<configDir>/.sparqly-queries.yaml`. Path is overridable via a top-level `savedQueries.path:` key in the main config.
- **YAML, not JSON.** Entries are dual-authored — the webapp writes most of them, but multi-line SPARQL bodies are still occasionally hand-edited, and `|` literal blocks beat escaped JSON strings for that case.
- **The webapp's writer uses `yaml`'s Document API**, not `stringify` over a plain object. User comments, unknown future fields, and formatting around untouched entries are preserved across a write.
- **Optimistic concurrency via derived ETag.** `GET /api/saved-queries/:id` returns an `ETag` whose value is a short content hash (`sha256(serialized-entry).slice(0, 16)`); `PUT` and `DELETE` require `If-Match: <etag>`; mismatch returns `412 Precondition Failed`. No `version:` field persisted in the YAML — derivation eliminates content-vs-version drift by construction.
- **Atomicity at the file level is write-temp-then-rename**, layered underneath the entry-level optimistic concurrency above. Concurrent PUTs serialize through a process-wide write mutex; the file on disk is never half-written.
- **Slug-as-id, no separate display name.** Each entry's id is a user-supplied slug (`^[a-z0-9][a-z0-9-]{0,62}$`); it serves as both the YAML key and the URL identifier. `Save` overwrites the entry currently loaded; `Save as` requires a fresh slug; slug collision on `Save as` is a hard `409` error. Renames are id changes, no alias tombstones.
- **Read-only mode is consolidated into `/api/config`.** A `serve --read-only` flag (or equivalent config) flips `savedQueries.writable: false` on the existing `/api/config` envelope; the webapp reads it at boot and hides Save / Save-as / parameter-edit affordances. No separate `/api/capabilities` endpoint.

This ADR introduces the first path by which `serve` mutates project files. It does not lift the read-only invariant for any other surface; future writable surfaces (e.g., config-edit UI from `ideas.md`) will need their own ADR and their own `/api/config` capability gate.

## Considered options

- **Browser-only persistence (localStorage / IndexedDB).** Rejected for the headline use case: it cannot deliver "save once, see it in your teammate's browser." Also rules out git-versioning saved queries. The simplicity is real, but the trade-off is the entire share-with-the-team value prop.
- **Inline `savedQueries:` block in the main project config.** Rejected. The main config is hand-authored as a contract; round-tripping it through a webapp write would shuffle comments, normalize key order, and bleed formatting changes into a file the user signs as their own. `package.json` vs `package-lock.json` is the well-known precedent — hand-authored intent and machine-maintained journal want separate files.
- **JSON sidecar.** Rejected on ergonomics: SPARQL bodies are multi-line and benefit substantially from YAML's `|` literal block syntax for hand-editing. A machine-only format would have been simpler to write, but the file is dual-authored, so the writer-side win does not pay for the reader-side cost.
- **Persistent `version:` field per entry, exposed as ETag.** Rejected in favor of derived hashes. Persisted versions drift from content the moment a hand-edit bumps content without bumping the version; derived hashes are correct by construction and remove a YAML clutter line per entry.
- **Last-write-wins, no concurrency protection.** Rejected. Two browsers (or two tabs) editing the same template silently lose one user's work — the exact failure mode that turns a collaboration feature into a bug factory. The cost of `If-Match` (one header, one error code, one client-side conflict dialog) is small in proportion.
- **Server-side mutex without versioning (entry-level last-write-wins on top of file-level atomicity).** Rejected as the user-facing layer for the same silent-data-loss reason; retained as the file-level primitive *underneath* optimistic concurrency.
- **UUID / opaque ids with a separate human display name.** Rejected. UUID keys destroy the value proposition of a hand-editable YAML sidecar — nobody reads or types UUIDs from memory. URLs become opaque, error messages become opaque, the file diff in code review becomes unreadable. Renames-are-free was the only real win and is paid for by every other surface paying friction forever.
- **Alias tombstones on rename (`aliases: [old-slug]` resolved alongside canonical ids).** Rejected as default behavior. The "rename a saved query" workflow should be rare; the alias mechanic is overhead until it isn't, at which point it can be added non-breakingly.
- **OS-permissions-based read-only mode (`chmod` the sidecar; let writes fail at OS layer).** Rejected. The UI doesn't know writes will fail until it tries one, and the user gets a vague server error instead of a hidden affordance. A first-class flag means write-capability is known at boot and the affordance is gated cleanly.
- **A dedicated `/api/capabilities` endpoint.** Rejected as premature. Write-capability is a config-level fact, not a runtime probe, and `/api/config` is already fetched at boot for the same audience. Consolidating saves one network round-trip and one endpoint to maintain. If future capabilities don't fit the `/api/config` shape, a dedicated endpoint can be carved out then.

## Consequences

- **The read-only invariant on `serve` is no longer absolute.** This ADR is the place future maintainers should look to understand why a CLI tool's HTTP server has a write path. Any further writable surface should reference this ADR and explain why it earns the same departure.
- **A new `libs/core/src/lib/saved-queries/` (or named analogously) module owns the sidecar schema (Zod), reader, structure-aware writer, and ETag derivation.** Pure functions over the parsed entries; no I/O outside the loader.
- **`libs/server/src/lib/` grows a CRUD controller (`GET / PUT / DELETE /api/saved-queries[/:id]`)** that mediates between HTTP and the core module, performs `If-Match` validation, and serializes writes through a process-wide mutex.
- **`/api/config` gains a `savedQueries: { writable: boolean }` field.** The webapp reads it at boot and gates write affordances on it. ADR-0011's "registry-aware webapp surface" framing already covers this — write-capability is just one more piece of the registry-aware envelope.
- **A new `serve --read-only` CLI flag.** When set, the server's write endpoints return `405 Method Not Allowed` and `savedQueries.writable` is `false`. CLI parity for the equivalent config-block knob is straightforward.
- **YAML round-tripping is now a load-bearing property** of the codebase, not just a nicety. The `yaml` Document-API writer earns a `.spec` covering the cases that matter: comment preservation around untouched entries, key-order preservation, untouched fields unknown to the schema, and the diff produced by a single-entry edit (should touch only that entry's lines).
- **The sidecar path overrides the config-relative default**, never the cwd-relative default. `--config path/to/foo.yaml` resolves the sidecar at `path/to/.sparqly-queries.yaml`; the override key (`savedQueries.path:`) is relative to the same `configDir`.
- **CONTEXT.md additions:** **Saved query**, **Templated saved query**, **Parameter declaration**, **Parameter binding**, **Saved-query sidecar**, **Saved-query ETag**, **Webapp writability capability**. Relationships extended to clarify that **Saved query** is webapp-scoped state distinct from **View**, and that the sidecar is the only `serve` write path.
- **No CLI subcommand for saved queries in this ADR.** A future `sparqly query --saved <slug>` (with `--bind name=value` repeats for templated entries) is a natural extension that would reuse the same shared substitution module; out of scope here.
