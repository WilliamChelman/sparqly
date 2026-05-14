# Multi-origin best-effort aggregation in `/api/describe`

`/api/describe` resolves a seed IRI across N selected sources and merges the results. Per the existing contract (CONTEXT.md, ADR-0015), one source failing must not fail the request — `perSource[id].error?` carries per-source failures and HTTP 502 fires only when *every* selected source failed. ADR-0024's default — one `Result<T, E>` per call — would force "partial failure" into the error channel and lose per-source attribution. We deliberately deviate: per-source failures travel as **data** inside the ok payload; only the all-failed terminal case errs the top-level `Result`.

## Decision

- The describe service signature is `ResultAsync<DescribeResult, AllSourcesFailedError | EmptyTargetError | SeedNotIriError | ReferenceTargetError>`.
  - `DescribeResult` carries `{ total, quads, perSource: Record<string, { count, truncated, error?: DescribeError }> }`.
  - Top-level err variants are the ones that fail the *whole* request (precondition violation or every source failed); per-source resolution failures live inside `ok.perSource[id].error`.
- `DescribeError` (the per-source error type) is a standard ADR-0024 union — `SourceWrappedError`, `EndpointDescribeError`, etc. — and follows the wrap-don't-duplicate idiom for upstream errors.
- The aggregator runs each per-source resolution through `neverthrow` combinators (per-source `ResultAsync.combineWithAllErrors` or equivalent that never short-circuits), folds each outcome into `perSource[id]`, and only constructs the top-level `AllSourcesFailedError` when no source produced quads.
- `describe-http-errors.ts` maps the top-level union: `all-sources-failed` → 502, the three precondition variants → 400. The ok branch with non-empty `perSource[].error` returns 200 unchanged — per-source errors do not affect HTTP status.

## Considered alternatives

- **Single union with a `PartialFailure` variant.** Rejected: conflates aggregation state with error semantics; callers would have to read the variant to know whether the request actually succeeded. The whole point of `Result.match()` is that `ok`/`err` answers that question; collapsing partial-success into `err` defeats it.
- **`ResultAsync<DescribeResult, DescribeError[]>` for the all-failed case.** Rejected: an array loses the per-source attribution `perSource[id]` already provides on the ok branch, and forces two different shapes for the same information depending on whether *any* source succeeded.
- **`Promise.allSettled` outside the neverthrow rhythm.** Rejected: works but bifurcates the codebase's error-handling style. The aggregator uses the same combinators the rest of `libs/server` uses; reviewers don't have to context-switch.
