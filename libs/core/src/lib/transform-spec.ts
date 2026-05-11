import type { Store } from 'n3';
import type { RdfRecord } from './engine';

/**
 * Side-channel data threaded through the pipeline alongside the Store.
 *
 * Transforms that need provenance (e.g. `graphName: forceAll` rewrites quads
 * to `file://${file}` graphs) cannot recover per-quad file origin from the
 * merged Store alone, so the loader exposes per-file ordered records here.
 */
export interface TransformContext {
  /** Per-file ordered records from the most recent glob load, keyed by absolute path. */
  perFileRecords?: ReadonlyMap<string, ReadonlyArray<RdfRecord>>;
}

export type TransformApply = (
  store: Store,
  ctx?: TransformContext,
) => Store;

/** Result of a {@link TransformDefinition.parse} call. */
export interface ParsedTransformResult {
  apply: TransformApply;
  /**
   * Opaque per-transform configuration the canonicalize/diff layer can
   * inspect by key (e.g. annotate's predicate IRIs). Transforms with no
   * downstream-relevant config may omit this.
   */
  config?: unknown;
}

export interface TransformDefinition<TInput = unknown> {
  /** Discriminator key on the source-spec list item (e.g. `graphName`, `annotate`). */
  key: string;
  /**
   * Validate the raw value under `key` and return the bound apply function
   * (optionally with downstream-visible config).
   */
  parse(rawValue: TInput): TransformApply | ParsedTransformResult;
}

export interface ParsedTransform {
  key: string;
  apply: TransformApply;
  /** Opaque config exposed by the transform for downstream consumers. */
  config?: unknown;
}

export function parseTransformList(
  raw: unknown,
  registry: ReadonlyArray<TransformDefinition>,
): ParsedTransform[] {
  if (!Array.isArray(raw)) {
    throw new Error('`transforms` must be an array of transform objects');
  }
  const out: ParsedTransform[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < raw.length; i++) {
    const parsed = parseOne(raw[i], i, registry);
    const prev = seen.get(parsed.key);
    if (prev !== undefined) {
      throw new Error(
        `duplicate transform key "${parsed.key}" at transforms[${prev}] and transforms[${i}]; each transform may appear at most once per source`,
      );
    }
    seen.set(parsed.key, i);
    out.push(parsed);
  }
  return out;
}

function parseOne(
  item: unknown,
  index: number,
  registry: ReadonlyArray<TransformDefinition>,
): ParsedTransform {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(
      `transforms[${index}] must be an object with exactly one transform key`,
    );
  }
  const keys = Object.keys(item as Record<string, unknown>);
  if (keys.length !== 1) {
    throw new Error(
      `transforms[${index}] must declare exactly one transform key (got ${
        keys.length === 0 ? '<none>' : keys.join(', ')
      })`,
    );
  }
  const key = keys[0];
  const def = registry.find((d) => d.key === key);
  if (!def) {
    const known = registry.map((d) => d.key);
    const knownNote =
      known.length === 0 ? 'no transforms registered' : `known: ${known.join(', ')}`;
    throw new Error(
      `transforms[${index}]: unknown transform key "${key}" (${knownNote})`,
    );
  }
  const parsed = def.parse((item as Record<string, unknown>)[key]);
  if (typeof parsed === 'function') {
    return { key, apply: parsed };
  }
  return { key, apply: parsed.apply, config: parsed.config };
}
