import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import type { GitPort } from './git-port';

export interface UnresolvableRefError {
  kind: 'unresolvable-ref';
  ref: string;
  repoRoot: string;
}

/**
 * Resolves a git ref string (full SHA, short SHA, annotated tag, or — in later
 * slices — a floating ref like a branch) to a 40-char commit SHA via the
 * narrow {@link GitPort}. Unresolvable refs surface as a typed
 * {@link UnresolvableRefError}.
 *
 * Slice 1 (ADR-0029) calls this only for pinned-ref inputs; later slices reuse
 * it for floating refs without changing the contract.
 */
export function resolveGitRefToSha(
  port: Pick<GitPort, 'resolveRefToSha'>,
  repoRoot: string,
  ref: string,
): ResultAsync<string, UnresolvableRefError> {
  return ResultAsync.fromSafePromise(
    port.resolveRefToSha(repoRoot, ref),
  ).andThen<string, UnresolvableRefError>((sha) =>
    sha === null
      ? errAsync({ kind: 'unresolvable-ref', ref, repoRoot })
      : okAsync(sha),
  );
}
