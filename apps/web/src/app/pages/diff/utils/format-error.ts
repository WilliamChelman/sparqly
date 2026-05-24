import type { DiffError, TargetError } from '../models/diff-error';

export function formatDiffError(error: DiffError): string {
  switch (error.kind) {
    case 'tabular-blank-node':
      return `tabular diff cannot key a row with a blank-node-valued column ?${error.column}: blank nodes have no cross-side identity. Project a stable IRI or literal in your SELECT (e.g. via a deterministic IRI mint or by selecting an identifying property) instead.`;
    case 'target':
      return formatTargetError(error.target);
    case 'legacy-message':
      return error.message;
  }
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
