/**
 * Tagged-union error type owned by the `target` feature folder. Adding a
 * variant is one edit here plus one new case in `formatTargetError`. See
 * ADR-0024 for the surrounding convention.
 *
 * Covers every registry-selection failure surfaced by `selectTargetResult`
 * and `resolveServeScopeResult`:
 *
 *   ref-as-target     a `kind: 'reference'` registry entry was selected as a target
 *   empty-registry    no target argument and the registry is empty
 *   no-default-multi  multi-entry registry with no `default: true` and no target arg
 *   unknown-ref       `@id` does not match any registry entry
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
  /** The offending ref as written by the caller, e.g. `@nope`. */
  ref: string;
  availableIds: ReadonlyArray<string>;
}

export function formatTargetError(error: TargetError): string {
  switch (error.kind) {
    case 'ref-as-target':
      return "`kind: 'reference'` entries are aliases, not data, and cannot be used as a target source";
    case 'empty-registry':
      return 'registry is empty; no target source to select';
    case 'no-default-multi':
      return `registry has multiple entries and no \`default: true\`; pass an explicit target. Available: ${formatAvailable(error.availableIds)}`;
    case 'unknown-ref':
      return `no source matches ${error.ref}. Available: ${formatAvailable(error.availableIds)}`;
  }
}

function formatAvailable(ids: ReadonlyArray<string>): string {
  if (ids.length === 0) return '<none>';
  return ids.map((id) => `@${id}`).join(', ');
}
