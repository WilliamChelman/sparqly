import type { ParsedSource } from 'core';

/**
 * Thrown when `--at <ref>` is supplied alongside a non-glob target. The flag
 * desugars onto `ParsedGlobSource.gitRef` (ADR-0029, issue #272 slice 1) and
 * has no meaning for endpoints, views, references, or empty sources.
 */
export class AtOverrideError extends Error {
  constructor(target: ParsedSource) {
    super(
      `--at applies only to glob sources; target ${describeTarget(target)} is a ${target.kind} source`,
    );
    this.name = 'AtOverrideError';
  }
}

/**
 * Apply the invocation-time `--at <ref>` override to a resolved target. Returns
 * the target unchanged when `at` is absent; replaces (or sets) `gitRef` on a
 * glob target when present; throws {@link AtOverrideError} for any other kind.
 */
export function applyAtOverride(
  target: ParsedSource,
  at: string | undefined,
): ParsedSource {
  if (at === undefined) return target;
  if (target.kind !== 'glob') throw new AtOverrideError(target);
  return { ...target, gitRef: at };
}

function describeTarget(target: ParsedSource): string {
  if (target.id !== undefined) return `@${target.id}`;
  if (target.kind === 'endpoint') return target.endpoint;
  if (target.kind === 'glob') return target.glob;
  if (target.kind === 'file') return target.path;
  return `<${target.kind}>`;
}
