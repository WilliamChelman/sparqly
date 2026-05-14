import { ANNOTATE_SOURCE_TRANSFORM } from './annotate-transform';
import type { ParsedSource } from './source-spec';
import type { ParsedTransform } from './transform-spec';

/**
 * ADR-0008 carve-out: `diff` prepends `annotateSource` to a glob (or split-glob
 * file child — ADR-0027) target's transform pipeline so HTML/turtle/json
 * output gets line numbers without ceremony. No-op when:
 *  - `skipAuto` is true (caller passed `--skip-auto-source-annotation`),
 *  - the target is not a materialized-file kind (views and endpoints can't
 *    carry source records),
 *  - the target already declares `annotateSource` (explicit predicates win).
 */
export function withAutoSourceAnnotation(
  target: ParsedSource,
  opts: { skipAuto: boolean },
): ParsedSource {
  if (opts.skipAuto) return target;
  if (target.kind !== 'glob' && target.kind !== 'file') return target;
  const declared = target.transforms ?? [];
  if (declared.some((t) => t.key === 'annotateSource')) return target;
  const parsed = ANNOTATE_SOURCE_TRANSFORM.parse({});
  const implicit: ParsedTransform =
    typeof parsed === 'function'
      ? { key: 'annotateSource', apply: parsed }
      : { key: 'annotateSource', apply: parsed.apply, config: parsed.config };
  return { ...target, transforms: [implicit, ...declared] };
}
