import type { SourceSpecObjectInput } from './source-spec';

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
