/**
 * Wire mirror of `libs/core/src/lib/diff/errors.ts`. Each variant carries
 * structured fields so the renderer can highlight the offending SELECT chip
 * for `tabular-blank-node`; `legacy-message` is the transitional bucket for
 * un-converted thrown messages (ADR-0024).
 *
 * `target` follows the wrap-don't-duplicate rule: registry-selection failures
 * live in their own `TargetError` union and are rendered here by dispatching
 * on `target.kind` rather than duplicating variants per consumer.
 */
export type DiffError =
  | TabularBlankNodeError
  | TargetWrappedError
  | LegacyMessageError;

export interface TabularBlankNodeError {
  kind: 'tabular-blank-node';
  column: string;
}

export interface TargetWrappedError {
  kind: 'target';
  side: 'left' | 'right';
  target: TargetError;
}

/**
 * Wire mirror of `libs/core/src/lib/target/errors.ts`. The webapp inline-error
 * renderer dispatches on `kind` to render structured registry-selection
 * failures (e.g. `unknown @id` with the list of available ids).
 */
export type TargetError =
  | RefAsTargetError
  | EmptyRegistryError
  | NoDefaultMultiError
  | UnknownRefError;

export interface RefAsTargetError {
  kind: 'ref-as-target';
}

export interface EmptyRegistryError {
  kind: 'empty-registry';
}

export interface NoDefaultMultiError {
  kind: 'no-default-multi';
  availableIds: ReadonlyArray<string>;
}

export interface UnknownRefError {
  kind: 'unknown-ref';
  ref: string;
  availableIds: ReadonlyArray<string>;
}

export interface LegacyMessageError {
  kind: 'legacy-message';
  message: string;
}

export interface DiffErrorResponse {
  kind: 'error';
  errors: { left?: DiffError; right?: DiffError; top?: DiffError };
}
