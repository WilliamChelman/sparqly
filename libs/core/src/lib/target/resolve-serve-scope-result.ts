import { err, ok, type Result } from 'neverthrow';
import {
  parseSourceSpec,
  type DefaultMarkerField,
  type ParsedSource,
} from '../sources';
import type { UnknownRefError } from './errors';

export interface ServeScope {
  /** Sources `serve` routes (`/api/sparql/<id>`) and lists via `/api/config`. */
  servedRegistry: ParsedSource[];
  /** Sources available for `from:` chain resolution; a superset of the served set. */
  resolutionRegistry: ParsedSource[];
  /** `@id` the unparameterized `/api/sparql` forwards to, or `undefined` if none. */
  defaultId: string | undefined;
}

/**
 * Primary `Result`-typed implementation of serve-scope resolution. The legacy
 * `resolveServeScope` is a thin throw-wrapping adapter around this function
 * (ADR-0024). Only the explicit `@id` ref path can fail with a typed
 * `unknown-ref` error; every other shape is total.
 */
export function resolveServeScopeResult(
  registry: ReadonlyArray<ParsedSource>,
  source?: string,
): Result<ServeScope, UnknownRefError> {
  const candidates = registry.filter((s) => s.kind !== 'reference');
  if (source !== undefined) {
    if (source.startsWith('@')) {
      const entry = resolveRef(candidates, source);
      if (entry.isErr()) return err(entry.error);
      return ok({
        servedRegistry: [entry.value],
        resolutionRegistry: [...registry],
        defaultId: recomputeDefault([entry.value]),
      });
    }
    const synthesized = withDefaultId(parseSourceSpec(source));
    return ok({
      servedRegistry: [synthesized],
      resolutionRegistry: [synthesized, ...registry],
      defaultId: 'default',
    });
  }
  const served = normalizeLoneIdLess(candidates);
  const resolutionRegistry =
    served === candidates ? [...registry] : [...served];
  return ok({
    servedRegistry: [...served],
    resolutionRegistry,
    defaultId: recomputeDefault(served),
  });
}

function resolveRef(
  candidates: ReadonlyArray<ParsedSource>,
  source: string,
): Result<ParsedSource, UnknownRefError> {
  const ref = source.slice(1);
  const entry = candidates.find((s) => s.id === ref);
  if (entry !== undefined) return ok(entry);
  return err({
    kind: 'unknown-ref',
    ref: source,
    availableIds: collectIds(candidates),
  });
}

function collectIds(
  registry: ReadonlyArray<ParsedSource>,
): ReadonlyArray<string> {
  return registry
    .map((s) => s.id)
    .filter((id): id is string => id !== undefined);
}

function normalizeLoneIdLess(
  served: ReadonlyArray<ParsedSource>,
): ReadonlyArray<ParsedSource> {
  if (served.length === 1 && served[0].id === undefined) {
    return [withDefaultId(served[0])];
  }
  return served;
}

function withDefaultId(entry: ParsedSource): ParsedSource {
  return { ...entry, id: 'default', default: true } as ParsedSource;
}

function recomputeDefault(
  served: ReadonlyArray<ParsedSource>,
): string | undefined {
  const marked = served.find((s) => (s as DefaultMarkerField).default === true);
  if (marked !== undefined) return marked.id;
  if (served.length === 1) return served[0].id;
  return undefined;
}
