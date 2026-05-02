---
status: accepted
---

# Views with a single endpoint upstream resolve via pass-through

When a view's `from:` is exactly one endpoint upstream, the view query is sent over the SPARQL protocol to that endpoint via Comunica federation rather than materializing the endpoint's full content into a local in-memory `Store`. This extends the `pass-through` mode that `loadQuerySources` already implements for the `query` command (`libs/core/src/lib/load-query-sources.ts:13`) to the `view-resolver` path used by `hash`, `diff`, and declared `view` sources, so the user's scoping query is bounded by the endpoint's compute and only the result set crosses the wire.

## Considered Options

- **Hand-rolled SPARQL HTTP client.** Rejected — Comunica federation already handles SPARQL-protocol endpoints, including `auth`/`headers`/`timeoutMs` via `buildEndpointContext` and error wrapping via `describeEndpointError`. Reusing it keeps a single endpoint-call code path with the existing `query` pass-through.
- **Opt-in flag (`--pass-through` or per-source `passThrough: true`).** Rejected — the materialize-then-query path is a correctness/scalability trap with no legitimate use case for endpoint upstreams. A flag would imply the materialize path is a reasonable choice.
- **Discriminated-union refactor of `loadUpstream` (`store | endpoint-context`).** Rejected for now — pass-through is short-circuited at the top of `resolveViewInternal` so the materialize path stays untouched. The refactor would be needed only if partial pass-through across heterogeneous upstreams is added later.
- **Warn-and-materialize for multi-upstream views containing an endpoint.** Rejected — the same OOM trap reappears under a different shape. `parseSourceSpecs` rejects at parse time when a `view.from` mixes an endpoint ref with anything else, linking to a tracking issue for federation across heterogeneous upstreams.
- **Keep the cache freshness probe as a local `ASK` over the materialized upstream.** Rejected — that probe re-creates the same OOM bug on every cache check. The `ASK` passes through to the endpoint via the same Comunica context.

## Consequences

- **`view-resolver.ts` short-circuits**: when `view.from.length === 1` and the resolved upstream is a `ParsedEndpointSource`, the resolver runs `engine.query(viewQuery, buildEndpointContext(endpoint))` and returns its result. The `kind === 'endpoint'` branch in `loadUpstream` becomes dead code under the new parse-time rejection (below) and is removed.
- **`ViewCacheBinding` shape changes**: `loadProbeStore: () => Promise<Store>` becomes `runProbe: (askQuery: string) => Promise<boolean>`. The resolver constructs `runProbe` to either issue the `ASK` over Comunica federation (single-endpoint upstream) or run it locally on the materialized Store (everything else). The cache layer no longer dispatches on source kind.
- **Cache key is unchanged**: `viewCacheKey` already hashes the upstream `ParsedSource` shape including endpoint URL, `auth`, `headers`, `timeoutMs`. Switching from materialize to pass-through does not invalidate existing on-disk caches.
- **Parse-time rejection in `parseSourceSpecs`**: a `view.from` containing an endpoint ref must be the only ref. Mixed and multi-endpoint upstreams throw with a tracking-issue URL (matching the `NOT_SUPPORTED_TRACKING_URL` convention in `load-sources.ts:14`).
- **Command help text**: the "Always materializes" wording in `hash.ts` and `diff.ts` is replaced with "Materializes the *result*; for endpoint-backed views the query passes through to the endpoint."
- **Tests**: an e2e fixture endpoint built on `helpers/serve.ts` records inbound SPARQL strings; assertions check that the user's view query reaches the endpoint and that the legacy `SELECT ?s ?p ?o WHERE { ?s ?p ?o }` does not. Unit tests in `view-resolver.spec.ts` lock in the dispatch by stubbing the Comunica engine.
- **Behavior change**: endpoint-backed views are now bounded by the endpoint's compute and the user's query, not by the size of the triplestore. Existing pipelines that produced results from endpoint-backed views continue to do so; only the resolution path changes.
- **Glossary**: introduces the **materialized ↔ pass-through** dichotomy as the single canonical pair across the codebase (see `CONTEXT.md`); "pushdown" is not used.
