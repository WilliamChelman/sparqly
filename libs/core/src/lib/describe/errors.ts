import { formatSourceError, type SourceError } from '../sources/errors';

export type DescribeError =
  | DescribeSourceWrappedError
  | EndpointDescribeError
  | EmptySourceError
  | ReferenceSourceError
  | DiskBackedSourceError;

export interface DescribeSourceWrappedError {
  kind: 'source';
  source: SourceError;
}

export interface EndpointDescribeError {
  kind: 'endpoint-describe';
  endpoint: string;
  message: string;
}

export interface EmptySourceError {
  kind: 'empty-source';
  id: string;
}

export interface ReferenceSourceError {
  kind: 'reference-source';
  id: string;
  ref: string;
}

export interface DiskBackedSourceError {
  kind: 'disk-backed-source';
  id: string;
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
    case 'disk-backed-source':
      return `source '${error.id}' is a disk-backed glob (\`storage: disk\`); describe does not support streaming from a disk-backed index`;
  }
}

/**
 * Top-level describe failure (ADR-0024). Describe now targets exactly one
 * source (ADR-0052), so the source's own {@link DescribeError} *is* the
 * request error — there is no `all-sources-failed` aggregate wrapper any more
 * (ADR-0025 retired). The remaining variants are precondition / routing
 * failures raised before (or instead of) dispatching to the source.
 */
export type DescribeTopLevelError =
  | DescribeError
  | EmptyTargetError
  | SeedNotIriError
  | DescribeReferenceTargetError
  | DescribeNoDefaultMultiError
  | ExpandedPathsWithoutSourceError
  | ExpandedPathsNonEndpointSourceError;

export interface EmptyTargetError {
  kind: 'empty-target';
}

export interface SeedNotIriError {
  kind: 'seed-not-iri';
  value: string;
}

export interface DescribeReferenceTargetError {
  kind: 'reference-target';
}

/**
 * `source` omitted on a registry with 2+ entries and no `default: true` marker.
 * API misuse: the caller must name a source or mark a default (ADR-0052 reuses
 * the ADR-0016 default-routing behind `/api/sparql`).
 */
export interface DescribeNoDefaultMultiError {
  kind: 'no-default-multi';
  availableIds: ReadonlyArray<string>;
}

export interface ExpandedPathsWithoutSourceError {
  kind: 'expanded-paths-without-source';
}

export interface ExpandedPathsNonEndpointSourceError {
  kind: 'expanded-paths-non-endpoint-source';
  id: string;
  sourceKind: string;
}

export function formatDescribeError(error: DescribeTopLevelError): string {
  switch (error.kind) {
    case 'source':
    case 'endpoint-describe':
    case 'empty-source':
    case 'reference-source':
    case 'disk-backed-source':
      return formatDescribePerSourceError(error);
    case 'empty-target':
      return 'describe: no target sources selected';
    case 'seed-not-iri':
      return `describe: seed ${JSON.stringify(error.value)} is not an IRI`;
    case 'reference-target':
      return "describe: every selected source is a `reference` alias; describe an actual data source instead";
    case 'no-default-multi':
      return `describe: \`source\` omitted but the registry has multiple entries and no \`default: true\`; name a source. Available: ${error.availableIds.map((id) => `@${id}`).join(', ')}`;
    case 'expanded-paths-without-source':
      return 'describe: `expandedPaths` requires `source` to be set (paths apply to a single endpoint source per request)';
    case 'expanded-paths-non-endpoint-source':
      return `describe: \`expandedPaths\` is only valid against \`endpoint\` sources; source '${error.id}' is \`${error.sourceKind}\``;
  }
}
