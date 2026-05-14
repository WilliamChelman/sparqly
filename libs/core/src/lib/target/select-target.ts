import type { ParsedSource } from '../sources';
import { formatTargetError } from './errors';
import { selectTargetResult } from './select-target-result';

/**
 * @deprecated Throw-wrapping adapter around {@link selectTargetResult} kept
 * for un-converted callers per ADR-0024. New code should consume the
 * `Result`-returning primary impl directly.
 */
export function selectTarget(
  registry: ReadonlyArray<ParsedSource>,
  target?: string,
): ParsedSource {
  const result = selectTargetResult(registry, target);
  if (result.isErr()) {
    throw new Error(`selectTarget: ${formatTargetError(result.error)}`);
  }
  return result.value;
}
