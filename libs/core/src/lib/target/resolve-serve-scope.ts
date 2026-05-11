import {
  parseSourceSpec,
  type DefaultMarkerField,
  type ParsedSource,
} from '../sources';

export interface ServeScope {
  /** Sources `serve` routes (`/api/sparql/<id>`) and lists via `/api/config`. */
  servedRegistry: ParsedSource[];
  /** Sources available for `from:` chain resolution; a superset of the served set. */
  resolutionRegistry: ParsedSource[];
  /** `@id` the unparameterized `/api/sparql` forwards to, or `undefined` if none. */
  defaultId: string | undefined;
}

export function resolveServeScope(
  registry: ReadonlyArray<ParsedSource>,
  source?: string,
): ServeScope {
  const candidates = registry.filter((s) => s.kind !== 'reference');
  if (source !== undefined) {
    if (source.startsWith('@')) {
      const entry = resolveRef(candidates, source);
      return {
        servedRegistry: [entry],
        resolutionRegistry: [...registry],
        defaultId: recomputeDefault([entry]),
      };
    }
    // Inline glob/URL: the served set is one synthesized `@default`; configured
    // `sources:` stay available for `from:` resolution only.
    const synthesized = withDefaultId(parseSourceSpec(source));
    return {
      servedRegistry: [synthesized],
      resolutionRegistry: [synthesized, ...registry],
      defaultId: 'default',
    };
  }
  const served = normalizeLoneIdLess(candidates);
  // A normalized lone source replaces the registry wholesale; otherwise the
  // full registry stays resolvable so `from:` chains keep working.
  const resolutionRegistry = served === candidates ? [...registry] : [...served];
  return {
    servedRegistry: [...served],
    resolutionRegistry,
    defaultId: recomputeDefault(served),
  };
}

function resolveRef(
  candidates: ReadonlyArray<ParsedSource>,
  source: string,
): ParsedSource {
  const ref = source.slice(1);
  const entry = candidates.find((s) => s.id === ref);
  if (entry !== undefined) return entry;
  throw new Error(
    `resolveServeScope: no source matches ${source}. Available: ${availableIds(candidates)}`,
  );
}

function availableIds(registry: ReadonlyArray<ParsedSource>): string {
  const ids = registry
    .map((s) => s.id)
    .filter((id): id is string => id !== undefined)
    .map((id) => `@${id}`);
  return ids.length === 0 ? '<none>' : ids.join(', ');
}

/** A single id-less source becomes `@default` with `default: true`. */
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
