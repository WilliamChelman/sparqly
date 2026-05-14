import type { ParsedSource } from '../sources';
import { formatTargetError } from './errors';
import {
  resolveServeScopeResult,
  type ServeScope,
} from './resolve-serve-scope-result';

export type { ServeScope } from './resolve-serve-scope-result';

/**
 * @deprecated Throw-wrapping adapter around {@link resolveServeScopeResult}
 * kept for un-converted callers per ADR-0024. New code should consume the
 * `Result`-returning primary impl directly.
 */
export function resolveServeScope(
  registry: ReadonlyArray<ParsedSource>,
  source?: string,
): ServeScope {
  const result = resolveServeScopeResult(registry, source);
  if (result.isErr()) {
    throw new Error(`resolveServeScope: ${formatTargetError(result.error)}`);
  }
  return result.value;
}
