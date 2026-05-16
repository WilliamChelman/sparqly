import { formatSourceError, type SourceError } from '../sources/errors';

/**
 * The describe feature folder's per-source error union (ADR-0025). A
 * per-source resolution failure travels as **data** inside the ok payload's
 * `perSource[id].error?` — only the all-failed terminal case errs the
 * top-level `Result`. Adding a variant is one edit here plus one new case in
 * `formatDescribePerSourceError`.
 *
 * Follows ADR-0024's wrap-don't-duplicate idiom for upstream errors: a glob
 * or view materialization failure surfaces as `SourceWrappedError` rather
 * than re-declaring `SourceError`'s variants here.
 */
export type DescribeError =
  | DescribeSourceWrappedError
  | EndpointDescribeError
  | EmptySourceError
  | ReferenceSourceError;

/**
 * Wraps an upstream {@link SourceError} from {@link resolveSourceResult}
 * (glob load, view error, endpoint fetch on a view's upstream, …) per
 * ADR-0024's wrap-don't-duplicate rule. Prefixed to disambiguate from
 * `diff/errors`'s side-bearing `SourceWrappedError`.
 */
export interface DescribeSourceWrappedError {
  kind: 'source';
  source: SourceError;
}

/**
 * Failure of the describe-endpoint flow itself (depth-0 SELECT / RDF-star
 * post-pass) — distinct from a view's upstream-endpoint fetch failure, which
 * arrives as a `SourceWrappedError` carrying `EndpointFetchError`.
 */
export interface EndpointDescribeError {
  kind: 'endpoint-describe';
  endpoint: string;
  message: string;
}

/** The selected source is an `empty` kind; it has no data of its own. */
export interface EmptySourceError {
  kind: 'empty-source';
  id: string;
}

/** The selected source is a `reference` alias, not a describable entry. */
export interface ReferenceSourceError {
  kind: 'reference-source';
  id: string;
  ref: string;
}

export function formatDescribePerSourceError(error: DescribeError): string {
  switch (error.kind) {
    case 'source':
      return formatSourceError(error.source);
    case 'endpoint-describe':
      return `endpoint ${error.endpoint}: ${error.message}`;
    case 'empty-source':
      return `source '${error.id}' is an empty source with no data of its own; to describe over it, describe a view that scopes this empty source's \`SERVICE\` composition`;
    case 'reference-source':
      return `source '${error.id}' is a \`reference\` alias to '${error.ref}'; describe that source directly`;
  }
}

/**
 * The describe feature folder's top-level error union (ADR-0025). These
 * variants fail the *whole* request — either a precondition was violated, or
 * every selected source failed (`AllSourcesFailedError`). Per-source
 * resolution failures live inside `ok.perSource[id].error` (see
 * {@link DescribeError}).
 */
export type DescribeTopLevelError =
  | AllSourcesFailedError
  | EmptyTargetError
  | SeedNotIriError
  | DescribeReferenceTargetError
  | ExpandedPathsWithoutSourceError
  | ExpandedPathsNonEndpointSourceError;

export interface AllSourcesFailedError {
  kind: 'all-sources-failed';
  perSource: Readonly<Record<string, DescribeError>>;
}

/** No describable target after request filtering (e.g. `sources: []`). */
export interface EmptyTargetError {
  kind: 'empty-target';
}

/** Seed value isn't a non-empty IRI. */
export interface SeedNotIriError {
  kind: 'seed-not-iri';
  value: string;
}

/**
 * Every selected target source is a `reference` alias. Prefixed to
 * disambiguate from `sources/errors`'s call-time `ReferenceTargetError`
 * (which fires inside `resolveSourceResult`, not as a top-level precondition).
 */
export interface DescribeReferenceTargetError {
  kind: 'reference-target';
}

/**
 * `expandedPaths` was supplied without `source`. Under ADR-0033 the field is
 * scoped to exactly one endpoint source per request, so it has no meaning
 * under the all-sources fan-out branch.
 */
export interface ExpandedPathsWithoutSourceError {
  kind: 'expanded-paths-without-source';
}

/**
 * `expandedPaths` was supplied with a `source` whose kind is not `endpoint`.
 * Path expansion only applies to endpoint sources — materialized sources are
 * already fully expanded — so the coupling is enforced at the request
 * boundary rather than silently ignored.
 */
export interface ExpandedPathsNonEndpointSourceError {
  kind: 'expanded-paths-non-endpoint-source';
  id: string;
  sourceKind: string;
}

export function formatDescribeError(error: DescribeTopLevelError): string {
  switch (error.kind) {
    case 'all-sources-failed': {
      const ids = Object.keys(error.perSource).sort();
      return `every selected source failed: ${ids.map((id) => `@${id}`).join(', ')}`;
    }
    case 'empty-target':
      return 'describe: no target sources selected';
    case 'seed-not-iri':
      return `describe: seed ${JSON.stringify(error.value)} is not an IRI`;
    case 'reference-target':
      return "describe: every selected source is a `reference` alias; describe an actual data source instead";
    case 'expanded-paths-without-source':
      return 'describe: `expandedPaths` requires `source` to be set (paths apply to a single endpoint source per request)';
    case 'expanded-paths-non-endpoint-source':
      return `describe: \`expandedPaths\` is only valid against \`endpoint\` sources; source '${error.id}' is \`${error.sourceKind}\``;
  }
}
