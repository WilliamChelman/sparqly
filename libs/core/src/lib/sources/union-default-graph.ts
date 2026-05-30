import type { ParsedSource, SourceSpecObjectInput } from './source-spec';

export function pickUnionDefaultGraph(
  input: SourceSpecObjectInput,
): { unionDefaultGraph?: boolean } {
  if (input.unionDefaultGraph === undefined) return {};
  if (typeof input.unionDefaultGraph !== 'boolean') {
    throw new Error('`unionDefaultGraph` must be a boolean');
  }
  return { unionDefaultGraph: input.unionDefaultGraph };
}

export function rejectUnionDefaultGraphOn(
  input: SourceSpecObjectInput,
  kind: 'endpoint' | 'empty',
): void {
  if (input.unionDefaultGraph !== undefined) {
    throw new Error(
      `\`unionDefaultGraph\` is only valid on glob sources (got a ${kind} source)`,
    );
  }
}

// Single defaulting point — callers read the effective value here, never the
// raw `unionDefaultGraph` field. Non-glob/file sources always report `false`.
export function unionDefaultGraphEnabled(source: ParsedSource): boolean {
  if (source.kind === 'glob' || source.kind === 'file') {
    return source.unionDefaultGraph ?? true;
  }
  return false;
}
