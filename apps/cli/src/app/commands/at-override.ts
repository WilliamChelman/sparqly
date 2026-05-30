import { parseSourceAddress, type ParsedSource } from 'core';

/**
 * Thrown when `--at <ref>` is supplied alongside a target it cannot pin —
 * endpoints, empty sources, references, or split-glob file children. Only glob
 * targets desugar onto `gitRef` (ADR-0029).
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
 * the target unchanged when `at` is absent; sets `gitRef` on a glob target;
 * throws {@link AtOverrideError} for any other kind (ADR-0029).
 */
export function applyAtOverride(
  target: ParsedSource,
  at: string | undefined,
): ParsedSource {
  if (at === undefined) return target;
  if (target.kind === 'glob') return { ...target, gitRef: at };
  throw new AtOverrideError(target);
}

/**
 * Split a positional CLI source argument into its target id and any trailing
 * `:ref` address-form pin (ADR-0029). Non-`@`-prefixed inputs and unparseable
 * addresses pass through with `positionalRef === undefined`, so inline globs
 * like `data/*.ttl` are untouched.
 */
export function splitPositionalAddress(raw: string | undefined): {
  targetArg: string | undefined;
  positionalRef: string | undefined;
} {
  if (raw === undefined || !raw.startsWith('@')) {
    return { targetArg: raw, positionalRef: undefined };
  }
  const parsed = parseSourceAddress(raw);
  if (parsed.isErr()) return { targetArg: raw, positionalRef: undefined };
  const { id, ref } = parsed.value;
  return { targetArg: `@${id}`, positionalRef: ref };
}

function describeTarget(target: ParsedSource): string {
  if (target.id !== undefined) return `@${target.id}`;
  if (target.kind === 'endpoint') return target.endpoint;
  if (target.kind === 'glob') return target.glob;
  if (target.kind === 'file') return target.path;
  return `<${target.kind}>`;
}
