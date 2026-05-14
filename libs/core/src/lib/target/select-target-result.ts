import { err, ok, type Result } from 'neverthrow';
import { parseSourceSpec, type ParsedSource } from '../sources';
import type { TargetError } from './errors';

/**
 * Primary `Result`-typed implementation of registry-target selection. The
 * legacy `selectTarget` is a thin throw-wrapping adapter around this function
 * (ADR-0024). Each err variant is exhaustively enumerated in `TargetError`.
 */
export function selectTargetResult(
  registry: ReadonlyArray<ParsedSource>,
  target?: string,
): Result<ParsedSource, TargetError> {
  const picked = pick(registry, target);
  if (picked.isErr()) return picked;
  if (picked.value.kind === 'reference') {
    return err({ kind: 'ref-as-target' });
  }
  return ok(picked.value);
}

function pick(
  registry: ReadonlyArray<ParsedSource>,
  target: string | undefined,
): Result<ParsedSource, TargetError> {
  if (target !== undefined) {
    if (target.startsWith('@')) return resolveRef(registry, target);
    return ok(parseSourceSpec(target));
  }
  const defaulted = registry.find(
    (s) => (s as { default?: true }).default === true,
  );
  if (defaulted !== undefined) return ok(defaulted);
  if (registry.length === 1) return ok(registry[0]);
  if (registry.length === 0) return err({ kind: 'empty-registry' });
  return err({
    kind: 'no-default-multi',
    availableIds: collectIds(registry),
  });
}

function resolveRef(
  registry: ReadonlyArray<ParsedSource>,
  target: string,
): Result<ParsedSource, TargetError> {
  const ref = target.slice(1);
  const entry = registry.find((s) => s.id === ref);
  if (entry !== undefined) return ok(entry);
  return err({
    kind: 'unknown-ref',
    ref: target,
    availableIds: collectIds(registry),
  });
}

function collectIds(
  registry: ReadonlyArray<ParsedSource>,
): ReadonlyArray<string> {
  return registry
    .map((s) => s.id)
    .filter((id): id is string => id !== undefined);
}
