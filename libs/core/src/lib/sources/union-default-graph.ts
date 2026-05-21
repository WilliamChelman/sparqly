import type { ParsedSource, SourceSpecObjectInput } from './source-spec';

/**
 * Union-default-graph parsing and resolution helpers (ADR-0040). Kept in a
 * dedicated module so `source-spec.ts` stays focused on the parse dispatch.
 */

/**
 * Picks the `unionDefaultGraph` field off a glob source-spec input, validating
 * it is a boolean. Returns an empty object when the field is omitted so the
 * spread leaves the parsed glob without the key (the `true` default is
 * resolved later by {@link unionDefaultGraphEnabled}).
 */
export function pickUnionDefaultGraph(
  input: SourceSpecObjectInput,
): { unionDefaultGraph?: boolean } {
  if (input.unionDefaultGraph === undefined) return {};
  if (typeof input.unionDefaultGraph !== 'boolean') {
    throw new Error('`unionDefaultGraph` must be a boolean');
  }
  return { unionDefaultGraph: input.unionDefaultGraph };
}

/**
 * Rejects `unionDefaultGraph` on a non-glob source-spec input (ADR-0040). An
 * endpoint owns its own dataset semantics and a view/empty source imports no
 * quads, so the field is meaningless — and silently ignoring it would mask a
 * config mistake.
 */
export function rejectUnionDefaultGraphOn(
  input: SourceSpecObjectInput,
  kind: 'endpoint' | 'view' | 'empty',
): void {
  if (input.unionDefaultGraph !== undefined) {
    throw new Error(
      `\`unionDefaultGraph\` is only valid on glob sources (got a ${kind} source)`,
    );
  }
}

/**
 * Resolves the effective union-default-graph setting for any source (ADR-0040).
 * Glob and file sources default to `true` when the field is omitted; every
 * other source kind reports `false` — an endpoint, view, or empty source runs
 * with standard SPARQL default-dataset semantics and the flag never applies.
 * This is the single defaulting point: read the effective value here, never
 * the raw `unionDefaultGraph` field.
 */
export function unionDefaultGraphEnabled(source: ParsedSource): boolean {
  if (source.kind === 'glob' || source.kind === 'file') {
    return source.unionDefaultGraph ?? true;
  }
  return false;
}
