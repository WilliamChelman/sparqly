import { formatSourceError, type SourceError } from '../sources/resolve-source-result';
import { formatTargetError, type TargetError } from '../target/errors';

// `legacy-message` is a transitional bucket for un-converted throws and is
// the catch-all for unexpected throws at the boundary.
// `target` wraps the cross-feature `TargetError` rather than duplicating its
// variants here.
export type DiffError =
  | TabularBlankNodeError
  | TargetWrappedError
  | MixedShapeError
  | SetMismatchError
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

export interface TargetWrappedError {
  kind: 'target';
  side: 'left' | 'right';
  target: TargetError;
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
    case 'target':
      return formatTargetError(error.target);
    case 'mixed-shape':
      return `mixed-shape diff: ${error.triplesSide}-side query is triples-shape (CONSTRUCT or SELECT-{?s,?p,?o[,?g]}) while ${error.tuplesSide}-side query is tuples-shape (arbitrary SELECT). Either project triples on both sides (graph diff) or arbitrary tuples on both sides (tabular diff) — pick one shape and align both queries.`;
    case 'set-mismatch': {
      const fmt = (vs: ReadonlyArray<string>): string =>
        `{${[...vs].sort().map((v) => `?${v}`).join(', ')}}`;
      return `tabular diff requires matching projected variable-name sets: left=${fmt(error.left)}, right=${fmt(error.right)}`;
    }
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
