import type { SourceSpecObjectInput } from './source-spec';

/**
 * Git-pinning field parsing for glob source-specs (ADR-0029). Kept beside
 * `source-spec-endpoint.ts` so `source-spec.ts` stays focused on parse
 * dispatch — the `pick`/`reject` helpers mirror that module's shape.
 */

/**
 * Picks the `gitRef`/`gitRoot` pinning fields off a glob source-spec input,
 * validating each is a non-empty string. `gitRoot` is only meaningful
 * alongside `gitRef` and is rejected when declared on its own (ADR-0029).
 */
export function pickGitFields(
  input: SourceSpecObjectInput,
): { gitRef?: string; gitRoot?: string } {
  const out: { gitRef?: string; gitRoot?: string } = {};
  if (input.gitRef !== undefined) {
    if (typeof input.gitRef !== 'string' || input.gitRef.length === 0) {
      throw new Error('`gitRef` must be a non-empty string');
    }
    out.gitRef = input.gitRef;
  }
  if (input.gitRoot !== undefined) {
    if (typeof input.gitRoot !== 'string' || input.gitRoot.length === 0) {
      throw new Error('`gitRoot` must be a non-empty string');
    }
    if (out.gitRef === undefined) {
      throw new Error(
        '`gitRoot` is only meaningful alongside `gitRef` (omit it otherwise)',
      );
    }
    out.gitRoot = input.gitRoot;
  }
  return out;
}

/**
 * Rejects `gitRef`/`gitRoot` on a non-glob source-spec input (ADR-0029).
 * Pinning is a glob-only concept — an endpoint, view, or empty source has no
 * filesystem content to read at a revision.
 */
export function rejectGitRefOn(
  input: SourceSpecObjectInput,
  kind: 'endpoint' | 'view' | 'empty',
): void {
  if (input.gitRef !== undefined) {
    throw new Error(
      `\`gitRef\` is only valid on glob sources (got a ${kind} source)`,
    );
  }
  if (input.gitRoot !== undefined) {
    throw new Error(
      `\`gitRoot\` is only valid on glob sources (got a ${kind} source)`,
    );
  }
}
