import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import type { GitPort } from './git-port';

export interface UnresolvableRefError {
  kind: 'unresolvable-ref';
  ref: string;
  repoRoot: string;
}

/**
 * Successful resolution of a git ref (ADR-0029, issue #273 slice 2).
 *
 * - `pinned` — the ref names a frozen object: a 40-char commit SHA or an
 *   annotated tag. Reproducible across fetches.
 * - `floating` — the ref names a moving target: branch, `HEAD`, `HEAD~n`,
 *   lightweight tag. The {@link sha} is current at resolution time, not
 *   reproducible across fetches.
 *
 * Short SHAs (hex strings shorter than 40 chars) classify as `floating` —
 * ADR-0029's strict "pinned ref" definition is full SHA + annotated tag only.
 */
export interface ResolvedGitRef {
  kind: 'pinned' | 'floating';
  /** 40-char commit SHA the ref resolves to. */
  sha: string;
  /** User-typed ref string, verbatim. */
  refString: string;
}

const FULL_SHA_RE = /^[0-9a-f]{40}$/;

/**
 * Resolves a git ref string to a 40-char commit SHA and classifies it as
 * {@link ResolvedGitRef.kind} `pinned` (full SHA / annotated tag) or
 * `floating` (branch, `HEAD`, `HEAD~n`, lightweight tag). The classification
 * lets the CLI log floating-ref → SHA resolutions at startup and lets the
 * source-record builder attach git provenance.
 */
export function resolveGitRef(
  port: Pick<GitPort, 'resolveRefToSha' | 'getRefObjectType'>,
  repoRoot: string,
  ref: string,
): ResultAsync<ResolvedGitRef, UnresolvableRefError> {
  return ResultAsync.fromSafePromise(
    port.resolveRefToSha(repoRoot, ref),
  ).andThen<ResolvedGitRef, UnresolvableRefError>((sha) => {
    if (sha === null) {
      return errAsync({ kind: 'unresolvable-ref', ref, repoRoot });
    }
    if (FULL_SHA_RE.test(ref)) {
      return okAsync({ kind: 'pinned', sha, refString: ref });
    }
    return ResultAsync.fromSafePromise(
      port.getRefObjectType(repoRoot, ref),
    ).map<ResolvedGitRef>((objectType) => ({
      kind: objectType === 'tag' ? 'pinned' : 'floating',
      sha,
      refString: ref,
    }));
  });
}
