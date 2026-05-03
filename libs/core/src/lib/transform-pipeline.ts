import type { Store } from 'n3';
import type { ParsedTransform, TransformContext } from './transform-spec';

/**
 * Apply a parsed transform list to a Store as a left-to-right reduce.
 *
 * Identity for `[]` (returns the input store reference). Each transform is
 * responsible for not mutating its input — this executor does not clone.
 */
export function applyTransformPipeline(
  store: Store,
  transforms: ReadonlyArray<ParsedTransform>,
  ctx?: TransformContext,
): Store {
  let current = store;
  for (const t of transforms) {
    current = t.apply(current, ctx);
  }
  return current;
}
