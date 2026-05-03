import type { GraphMode } from './rdf-loader';

export interface SourceSpecCommonFields {
  id?: string;
}

export interface GlobOnlyGraphFields {
  graphMode?: GraphMode;
  graph?: string;
}

export type SparqlAuth =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string };

export interface EndpointHttpFields {
  auth?: SparqlAuth;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface ParsedGlobSource
  extends SourceSpecCommonFields,
    GlobOnlyGraphFields {
  kind: 'glob';
  glob: string;
}

export interface ParsedEndpointSource
  extends SourceSpecCommonFields,
    EndpointHttpFields {
  kind: 'endpoint';
  endpoint: string;
}

export interface ParsedReferenceSource extends SourceSpecCommonFields {
  kind: 'reference';
  ref: string;
}

export interface ParsedViewCacheTtl {
  strategy: 'ttl';
  ttlMs: number;
  cacheDir?: string;
}

export interface ParsedViewCacheFreshness {
  strategy: 'freshness';
  freshness: string;
  cacheDir?: string;
}

export interface ParsedViewCacheEverlasting {
  strategy: 'everlasting';
  cacheDir?: string;
}

export type ParsedViewCache =
  | ParsedViewCacheTtl
  | ParsedViewCacheFreshness
  | ParsedViewCacheEverlasting;

export interface ParsedViewSource {
  kind: 'view';
  id: string;
  from: ReadonlyArray<string>;
  query?: string;
  queryFile?: string;
  cache?: ParsedViewCache;
}

export interface ViewCacheInput {
  ttl?: string | number;
  freshness?: string;
  everlasting?: boolean;
  cacheDir?: string;
}

export type ParsedSource =
  | ParsedGlobSource
  | ParsedEndpointSource
  | ParsedReferenceSource
  | ParsedViewSource;

export interface SourceSpecObjectInput
  extends SourceSpecCommonFields,
    GlobOnlyGraphFields,
    EndpointHttpFields {
  glob?: string;
  endpoint?: string;
  from?: ReadonlyArray<string>;
  query?: string;
  queryFile?: string;
  cache?: ViewCacheInput;
}

export type SourceSpecInput = string | SourceSpecObjectInput;

const HTTP_PREFIX = /^https?:\/\//;
const REFERENCE_PREFIX = /^@(.+)$/;
export const SOURCE_ID_REGEX = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/;

const COMMON_FIELD_KEYS = [
  'id',
] as const satisfies ReadonlyArray<keyof SourceSpecCommonFields>;

const GLOB_GRAPH_FIELD_KEYS = [
  'graphMode',
  'graph',
] as const satisfies ReadonlyArray<keyof GlobOnlyGraphFields>;

function validateSourceId(id: string): void {
  if (id.startsWith('@')) {
    throw new Error(`source id ${JSON.stringify(id)} must not start with \`@\``);
  }
  if (!SOURCE_ID_REGEX.test(id)) {
    throw new Error(
      `source id ${JSON.stringify(id)} must match ${SOURCE_ID_REGEX} (alphanumeric, _, -, .; no leading dot)`,
    );
  }
}

function pickCommon(input: SourceSpecObjectInput): SourceSpecCommonFields {
  const out: SourceSpecCommonFields = {};
  for (const k of COMMON_FIELD_KEYS) {
    const v = input[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function pickGlobGraph(input: SourceSpecObjectInput): GlobOnlyGraphFields {
  const out: GlobOnlyGraphFields = {};
  for (const k of GLOB_GRAPH_FIELD_KEYS) {
    const v = input[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function parseSourceSpec(input: SourceSpecInput): ParsedSource {
  if (typeof input === 'string') {
    if (HTTP_PREFIX.test(input)) {
      return { kind: 'endpoint', endpoint: input };
    }
    const refMatch = REFERENCE_PREFIX.exec(input);
    if (refMatch) {
      return { kind: 'reference', ref: refMatch[1] };
    }
    return { kind: 'glob', glob: input };
  }
  const hasGlob = input.glob !== undefined;
  const hasEndpoint = input.endpoint !== undefined;
  const hasFrom = input.from !== undefined;
  const setCount = [hasGlob, hasEndpoint, hasFrom].filter(Boolean).length;
  if (setCount !== 1) {
    throw new Error(
      'source-spec object must declare exactly one of `glob:`, `endpoint:`, or `from:`',
    );
  }
  if (input.id !== undefined) validateSourceId(input.id);
  if (hasFrom) {
    return parseView(input);
  }
  if (input.cache !== undefined) {
    throw new Error(
      '`cache` is only valid on view sources (`from:` blocks); see PRD #78',
    );
  }
  const common = pickCommon(input);
  if (hasGlob) {
    rejectEndpointOnlyFields(input);
    return {
      kind: 'glob',
      glob: input.glob as string,
      ...common,
      ...pickGlobGraph(input),
    };
  }
  rejectGlobGraphFieldsOnEndpoint(input);
  const http = pickEndpointHttp(input);
  return {
    kind: 'endpoint',
    endpoint: input.endpoint as string,
    ...common,
    ...http,
  };
}

function rejectGlobGraphFieldsOnEndpoint(input: SourceSpecObjectInput): void {
  for (const key of GLOB_GRAPH_FIELD_KEYS) {
    if ((input as Record<string, unknown>)[key] !== undefined) {
      throw new Error(
        `\`${key}\` is not valid on endpoint sources; express endpoint graph behaviour through a view's query (see #78)`,
      );
    }
  }
}

const VIEW_REF_PREFIX = /^@(.+)$/;

function parseView(input: SourceSpecObjectInput): ParsedViewSource {
  if (input.id === undefined) {
    throw new Error('view source: `id` is required');
  }
  const from = input.from as ReadonlyArray<string>;
  if (from.length === 0) {
    throw new Error('view source: `from` must list at least one ref');
  }
  const refs: string[] = [];
  for (const entry of from) {
    if (typeof entry !== 'string') {
      throw new Error(
        'view source: each `from` entry must be a `@id` ref string',
      );
    }
    const match = VIEW_REF_PREFIX.exec(entry);
    if (!match) {
      throw new Error(
        `view source: \`from\` entry ${JSON.stringify(entry)} must be a \`@id\` ref (e.g. \`@my-source\`)`,
      );
    }
    refs.push(match[1]);
  }
  const hasQuery = input.query !== undefined;
  const hasQueryFile = input.queryFile !== undefined;
  if (hasQuery && hasQueryFile) {
    throw new Error(
      'view source: `query` and `queryFile` are mutually exclusive',
    );
  }
  if (!hasQuery && !hasQueryFile) {
    throw new Error(
      'view source: must declare exactly one of `query` or `queryFile`',
    );
  }
  const out: ParsedViewSource = {
    kind: 'view',
    id: input.id,
    from: refs,
  };
  if (hasQuery) out.query = input.query;
  if (hasQueryFile) out.queryFile = input.queryFile;
  if (input.cache !== undefined) {
    out.cache = parseViewCache(input.id, input.cache);
  }
  return out;
}

const KNOWN_CACHE_KEYS = new Set([
  'ttl',
  'freshness',
  'everlasting',
  'cacheDir',
]);

function parseViewCache(viewId: string, raw: ViewCacheInput): ParsedViewCache {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(
      `view "${viewId}": \`cache\` must be an object declaring exactly one of \`ttl\`, \`freshness\`, or \`everlasting\``,
    );
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_CACHE_KEYS.has(key)) {
      throw new Error(
        `view "${viewId}": unknown \`cache\` key "${key}"`,
      );
    }
  }
  const declared: Array<'ttl' | 'freshness' | 'everlasting'> = [];
  if (raw.ttl !== undefined) declared.push('ttl');
  if (raw.freshness !== undefined) declared.push('freshness');
  if (raw.everlasting !== undefined) declared.push('everlasting');
  if (declared.length !== 1) {
    throw new Error(
      `view "${viewId}": \`cache\` must declare exactly one of \`ttl\`, \`freshness\`, or \`everlasting\` (got: ${
        declared.length === 0 ? '<none>' : declared.join(', ')
      })`,
    );
  }
  const cacheDir = parseCacheDir(viewId, raw.cacheDir);
  if (declared[0] === 'ttl') {
    const ttlMs = parseTtl(viewId, raw.ttl as string | number);
    return cacheDir === undefined
      ? { strategy: 'ttl', ttlMs }
      : { strategy: 'ttl', ttlMs, cacheDir };
  }
  if (declared[0] === 'freshness') {
    const freshness = raw.freshness as string;
    if (typeof freshness !== 'string' || freshness.trim().length === 0) {
      throw new Error(
        `view "${viewId}": \`cache.freshness\` must be a non-empty ASK query string`,
      );
    }
    return cacheDir === undefined
      ? { strategy: 'freshness', freshness }
      : { strategy: 'freshness', freshness, cacheDir };
  }
  if (raw.everlasting !== true) {
    throw new Error(
      `view "${viewId}": \`cache.everlasting\` must be \`true\` to opt into the everlasting strategy`,
    );
  }
  return cacheDir === undefined
    ? { strategy: 'everlasting' }
    : { strategy: 'everlasting', cacheDir };
}

function parseCacheDir(
  viewId: string,
  raw: string | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(
      `view "${viewId}": \`cache.cacheDir\` must be a non-empty string`,
    );
  }
  return raw;
}

const TTL_PATTERN = /^(\d+)(ms|s|m|h|d)$/;
const TTL_UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function parseTtl(viewId: string, raw: string | number): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0 || !Number.isInteger(raw)) {
      throw new Error(
        `view "${viewId}": \`cache.ttl\` numeric value must be a positive integer (ms)`,
      );
    }
    return raw;
  }
  if (typeof raw !== 'string') {
    throw new Error(
      `view "${viewId}": \`cache.ttl\` must be a duration string (e.g. "1h") or a positive integer (ms)`,
    );
  }
  const match = TTL_PATTERN.exec(raw.trim());
  if (!match) {
    throw new Error(
      `view "${viewId}": \`cache.ttl\` ${JSON.stringify(raw)} is not a valid duration (expected e.g. "100ms", "5s", "30m", "2h", "1d")`,
    );
  }
  const n = Number(match[1]);
  if (n <= 0) {
    throw new Error(
      `view "${viewId}": \`cache.ttl\` must be greater than zero`,
    );
  }
  return n * TTL_UNIT_MS[match[2]];
}

const ENDPOINT_ONLY_KEYS = ['auth', 'headers', 'timeoutMs'] as const;

function rejectEndpointOnlyFields(input: SourceSpecObjectInput): void {
  for (const key of ENDPOINT_ONLY_KEYS) {
    if ((input as Record<string, unknown>)[key] !== undefined) {
      throw new Error(
        `\`${key}\` is only valid on endpoint sources (got a glob source)`,
      );
    }
  }
}

function pickEndpointHttp(input: SourceSpecObjectInput): EndpointHttpFields {
  const out: EndpointHttpFields = {};
  if (input.auth !== undefined) {
    out.auth = validateAuth(input.auth);
  }
  if (input.headers !== undefined) out.headers = { ...input.headers };
  if (input.timeoutMs !== undefined) out.timeoutMs = input.timeoutMs;
  if (out.auth && out.headers) {
    for (const key of Object.keys(out.headers)) {
      if (key.toLowerCase() === 'authorization') {
        throw new Error(
          '`auth` and an explicit `Authorization` header collide on the same endpoint source',
        );
      }
    }
  }
  return out;
}

function validateAuth(auth: SparqlAuth): SparqlAuth {
  if (auth.type === 'bearer') {
    if (typeof auth.token !== 'string' || auth.token.length === 0) {
      throw new Error('bearer auth `token` must be a non-empty string');
    }
    return { type: 'bearer', token: auth.token };
  }
  if (auth.type === 'basic') {
    if (typeof auth.username !== 'string' || auth.username.length === 0) {
      throw new Error('basic auth `username` must be a non-empty string');
    }
    if (typeof auth.password !== 'string' || auth.password.length === 0) {
      throw new Error('basic auth `password` must be a non-empty string');
    }
    return {
      type: 'basic',
      username: auth.username,
      password: auth.password,
    };
  }
  throw new Error(
    `unknown auth type: ${JSON.stringify((auth as { type: unknown }).type)}`,
  );
}

export interface ParseSourceSpecsContext {
  /** Per-input human-readable location string for collision diagnostics. */
  locations?: ReadonlyArray<string>;
}

export const VIEW_ENDPOINT_MIXING_TRACKING_URL =
  'https://github.com/WilliamChelman/sparqly/issues/97';

export function parseSourceSpecs(
  inputs: ReadonlyArray<SourceSpecInput>,
  ctx?: ParseSourceSpecsContext,
): ParsedSource[] {
  const parsed = inputs.map((input) => parseSourceSpec(input));
  const locationFor = (i: number): string =>
    ctx?.locations?.[i] ?? `sources[${i}]`;
  const seen = new Map<string, number>();
  for (let i = 0; i < parsed.length; i++) {
    const id = parsed[i].id;
    if (id === undefined) continue;
    const prev = seen.get(id);
    if (prev !== undefined) {
      throw new Error(
        `duplicate source id "${id}" defined at ${locationFor(prev)} and ${locationFor(i)}`,
      );
    }
    seen.set(id, i);
  }
  validateSourceGraph(parsed);
  return parsed;
}

function validateSourceGraph(parsed: ReadonlyArray<ParsedSource>): void {
  const byId = new Map<string, ParsedSource>();
  for (const source of parsed) {
    if (source.id !== undefined) byId.set(source.id, source);
  }
  for (const source of parsed) {
    if (source.kind !== 'view') continue;
    const refKinds = source.from.map((ref) => byId.get(ref)?.kind);
    const hasEndpoint = refKinds.some((k) => k === 'endpoint');
    if (hasEndpoint && source.from.length > 1) {
      throw new Error(
        `view "${source.id}": \`from\` may not mix an endpoint ref with other refs (multi/heterogeneous federation is not yet supported; tracking: ${VIEW_ENDPOINT_MIXING_TRACKING_URL})`,
      );
    }
  }
}
