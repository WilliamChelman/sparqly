import { formatSourceError, type SourceError } from '../sources/resolve-source-result';

/**
 * The diff feature folder's error union. Every variant is a tagged object so
 * surfaces (web envelope, CLI, log lines) can switch on `kind` and keep the
 * structured payload (e.g. `column` for UI highlighting). Adding a variant is
 * one edit here plus one new case in `formatDiffError`.
 *
 * `legacy-message` is a transitional bucket for any remaining un-converted
 * thrown messages. As of slice 2 (#240) the diff service itself produces only
 * structured variants; this variant is retained for downstream callers and
 * older fixtures and is the no-op-on-arrival mapping for unexpected throws.
 */
export type DiffError =
  | TabularBlankNodeError
  | UnknownSourceIdError
  | MixedShapeError
  | SetMismatchError
  | EndpointAsDiffTargetError
  | InlineUpstreamKindError
  | AnonymousViewExecutionError
  | AnonymousSelectExecutionError
  | SourceWrappedError
  | LegacyMessageError;

export interface TabularBlankNodeError {
  kind: 'tabular-blank-node';
  /** SELECT projection variable whose value was a blank node. */
  column: string;
}

export interface UnknownSourceIdError {
  kind: 'unknown-source-id';
  side: 'left' | 'right';
  id: string;
  availableIds: ReadonlyArray<string>;
}

export interface MixedShapeError {
  kind: 'mixed-shape';
  triplesSide: 'left' | 'right';
  tuplesSide: 'left' | 'right';
}

export interface SetMismatchError {
  kind: 'set-mismatch';
  left: ReadonlyArray<string>;
  right: ReadonlyArray<string>;
}

export interface EndpointAsDiffTargetError {
  kind: 'endpoint-as-diff-target';
  side: 'left' | 'right';
  endpoint: string;
}

export interface InlineUpstreamKindError {
  kind: 'inline-upstream-kind';
  side: 'left' | 'right';
  targetKind: string;
}

export interface AnonymousViewExecutionError {
  kind: 'anonymous-view-execution';
  side: 'left' | 'right';
  message: string;
}

export interface AnonymousSelectExecutionError {
  kind: 'anonymous-select-execution';
  side: 'left' | 'right';
  message: string;
}

export interface SourceWrappedError {
  kind: 'source';
  side: 'left' | 'right';
  source: SourceError;
}

export interface LegacyMessageError {
  kind: 'legacy-message';
  message: string;
}

export function formatDiffError(error: DiffError): string {
  switch (error.kind) {
    case 'tabular-blank-node':
      return `tabular diff cannot key a row with a blank-node-valued column ?${error.column}: blank nodes have no cross-side identity. Project a stable IRI or literal in your SELECT (e.g. via a deterministic IRI mint or by selecting an identifying property) instead.`;
    case 'unknown-source-id': {
      const available =
        error.availableIds.length === 0
          ? '(none)'
          : error.availableIds.map((id) => `@${id}`).join(', ');
      return `unknown @id "${error.id}" on ${error.side} side; available: ${available}`;
    }
    case 'mixed-shape':
      return `mixed-shape diff: ${error.triplesSide}-side query is triples-shape (CONSTRUCT or SELECT-{?s,?p,?o[,?g]}) while ${error.tuplesSide}-side query is tuples-shape (arbitrary SELECT). Either project triples on both sides (graph diff) or arbitrary tuples on both sides (tabular diff) — pick one shape and align both queries.`;
    case 'set-mismatch': {
      const fmt = (vs: ReadonlyArray<string>): string =>
        `{${[...vs].sort().map((v) => `?${v}`).join(', ')}}`;
      return `tabular diff requires matching projected variable-name sets: left=${fmt(error.left)}, right=${fmt(error.right)}`;
    }
    case 'endpoint-as-diff-target':
      return `SPARQL endpoint ${error.endpoint} cannot be diffed directly on the ${error.side} side (wrap the endpoint in a \`view\` source kind to scope it, or pass \`${error.side}Query\` to scope it inline)`;
    case 'inline-upstream-kind':
      return `inline scoping query targets a glob or endpoint upstream; ${error.side} target is a ${error.targetKind} source`;
    case 'anonymous-view-execution':
      return error.message;
    case 'anonymous-select-execution':
      return error.message;
    case 'source':
      return formatSourceError(error.source);
    case 'legacy-message':
      return error.message;
  }
}
