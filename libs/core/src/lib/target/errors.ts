/** Tagged-union error type for registry-target selection (see ADR-0024). */
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
