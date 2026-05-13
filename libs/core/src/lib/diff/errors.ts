/**
 * The diff feature folder's error union. Every variant is a tagged object so
 * surfaces (web envelope, CLI, log lines) can switch on `kind` and keep the
 * structured payload (e.g. `column` for UI highlighting). Adding a variant is
 * one edit here plus one new case in `formatDiffError`.
 *
 * `legacy-message` is a transitional bucket holding the un-converted thrown
 * messages from `resolveSource` / parsing / `anonymousUpstream` until those
 * leaves are converted in subsequent slices (ADR-0024). It will be deleted
 * when the last legacy throw site has been replaced with a structured variant.
 */
export type DiffError = TabularBlankNodeError | LegacyMessageError;

export interface TabularBlankNodeError {
  kind: 'tabular-blank-node';
  /** SELECT projection variable whose value was a blank node. */
  column: string;
}

export interface LegacyMessageError {
  kind: 'legacy-message';
  message: string;
}

export function formatDiffError(error: DiffError): string {
  switch (error.kind) {
    case 'tabular-blank-node':
      return `tabular diff cannot key a row with a blank-node-valued column ?${error.column}: blank nodes have no cross-side identity. Project a stable IRI or literal in your SELECT (e.g. via a deterministic IRI mint or by selecting an identifying property) instead.`;
    case 'legacy-message':
      return error.message;
  }
}
