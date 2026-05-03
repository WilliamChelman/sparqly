import { ANNOTATE_TRANSFORM } from './annotate-transform';
import { GRAPH_NAME_TRANSFORM } from './graph-name-transform';
import {
  parseTransformList,
  type ParsedTransform,
  type TransformDefinition,
} from './transform-spec';

export interface SourceSpecCommonFields {
  id?: string;
}

export interface DefaultMarkerField {
  default?: true;
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
    DefaultMarkerField {
  kind: 'glob';
  glob: string;
  /** Parsed source-transformation pipeline (omitted when not declared). */
  transforms?: ParsedTransform[];
}

export interface ParsedEndpointSource
  extends SourceSpecCommonFields,
    EndpointHttpFields,
    DefaultMarkerField {
  kind: 'endpoint';
  endpoint: string;
}

export interface ParsedReferenceSource extends SourceSpecCommonFields {
  kind: 'reference';
  ref: string;
}

export interface ParsedEmptySource
  extends SourceSpecCommonFields,
    DefaultMarkerField {
  kind: 'empty';
  id: string;
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

export interface ParsedViewSource extends DefaultMarkerField {
  kind: 'view';
  id: string;
  from: string;
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
  | ParsedViewSource
  | ParsedEmptySource;

export interface SourceSpecObjectInput
  extends SourceSpecCommonFields,
    EndpointHttpFields {
  glob?: string;
  endpoint?: string;
  from?: string;
  empty?: true;
  query?: string;
  queryFile?: string;
  cache?: ViewCacheInput;
  default?: true;
  transforms?: ReadonlyArray<unknown>;
}

export type SourceSpecInput = string | SourceSpecObjectInput;

const HTTP_PREFIX = /^https?:\/\//;
const REFERENCE_PREFIX = /^@(.+)$/;
export const SOURCE_ID_REGEX = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/;

const COMMON_FIELD_KEYS = [
  'id',
] as const satisfies ReadonlyArray<keyof SourceSpecCommonFields>;

function pickDefault(input: SourceSpecObjectInput): DefaultMarkerField {
  if (input.default === undefined) return {};
  if (input.default !== true) {
    throw new Error('`default` must be `true` (omit the field otherwise)');
  }
  return { default: true };
}

const LEGACY_GLOB_GRAPH_FIELD_KEYS = ['graphMode', 'graph'] as const;

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

function rejectLegacyGlobGraphFields(input: SourceSpecObjectInput): void {
  for (const key of LEGACY_GLOB_GRAPH_FIELD_KEYS) {
    if ((input as Record<string, unknown>)[key] !== undefined) {
      throw new Error(
        `\`${key}\` was removed from the glob source-spec; express graph-name behaviour via the \`transforms\` pipeline (e.g. \`transforms: [{ graphName: 'forceAll' }]\`) — see ADR 0006`,
      );
    }
  }
}

/**
 * Closed registry of source transforms recognised by the source-spec parser.
 * Adding a transform: append a `TransformDefinition` here.
 */
export const TRANSFORM_REGISTRY: ReadonlyArray<TransformDefinition> = [
  GRAPH_NAME_TRANSFORM,
  ANNOTATE_TRANSFORM,
];

export interface ParseSourceSpecContext {
  /** Override the closed transform registry (test stubs only). */
  transformRegistry?: ReadonlyArray<TransformDefinition>;
}

export function parseSourceSpec(
  input: SourceSpecInput,
  ctx?: ParseSourceSpecContext,
): ParsedSource {
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
  const hasEmpty = input.empty === true;
  const setCount = [hasGlob, hasEndpoint, hasFrom, hasEmpty].filter(
    Boolean,
  ).length;
  if (setCount !== 1) {
    throw new Error(
      'source-spec object must declare exactly one of `glob:`, `endpoint:`, `from:`, or `empty:`',
    );
  }
  if (input.id !== undefined) validateSourceId(input.id);
  if (hasFrom) {
    rejectTransformsOn(input, 'view');
    return parseView(input);
  }
  if (hasEmpty) {
    return parseEmpty(input);
  }
  if (input.cache !== undefined) {
    throw new Error(
      '`cache` is only valid on view sources (`from:` blocks); see PRD #78',
    );
  }
  const common = pickCommon(input);
  const defaultMarker = pickDefault(input);
  if (hasGlob) {
    rejectEndpointOnlyFields(input);
    rejectLegacyGlobGraphFields(input);
    const registry = ctx?.transformRegistry ?? TRANSFORM_REGISTRY;
    const transformsField =
      input.transforms === undefined
        ? {}
        : { transforms: parseTransformList(input.transforms, registry) };
    return {
      kind: 'glob',
      glob: input.glob as string,
      ...common,
      ...transformsField,
      ...defaultMarker,
    };
  }
  rejectLegacyEndpointGraphFields(input);
  rejectTransformsOn(input, 'endpoint');
  const http = pickEndpointHttp(input);
  return {
    kind: 'endpoint',
    endpoint: input.endpoint as string,
    ...common,
    ...http,
    ...defaultMarker,
  };
}

function rejectTransformsOn(
  input: SourceSpecObjectInput,
  kind: 'endpoint' | 'view' | 'empty',
): void {
  if (input.transforms !== undefined) {
    throw new Error(
      `\`transforms\` is only valid on glob sources (got a ${kind} source)`,
    );
  }
}

function rejectLegacyEndpointGraphFields(input: SourceSpecObjectInput): void {
  for (const key of LEGACY_GLOB_GRAPH_FIELD_KEYS) {
    if ((input as Record<string, unknown>)[key] !== undefined) {
      throw new Error(
        `\`${key}\` is not valid on endpoint sources; express endpoint graph behaviour through a view's query (see #78)`,
      );
    }
  }
}

const EMPTY_FORBIDDEN_KEYS = [
  ...LEGACY_GLOB_GRAPH_FIELD_KEYS,
  'auth',
  'headers',
  'timeoutMs',
  'query',
  'queryFile',
  'cache',
  'transforms',
] as const;

function parseEmpty(input: SourceSpecObjectInput): ParsedEmptySource {
  if (input.id === undefined) {
    throw new Error('empty source: `id` is required');
  }
  for (const key of EMPTY_FORBIDDEN_KEYS) {
    if ((input as Record<string, unknown>)[key] !== undefined) {
      throw new Error(
        `empty source: \`${key}\` is not valid on empty sources`,
      );
    }
  }
  const defaultMarker = pickDefault(input);
  return { kind: 'empty', id: input.id, ...defaultMarker };
}

const VIEW_REF_PREFIX = /^@(.+)$/;

function parseView(input: SourceSpecObjectInput): ParsedViewSource {
  if (input.id === undefined) {
    throw new Error('view source: `id` is required');
  }
  if (Array.isArray(input.from)) {
    throw new Error(
      'view source: `from:` must be a single `@id` ref string; multi-source composition is expressed in SPARQL via `SERVICE` clauses inside the view query',
    );
  }
  if (typeof input.from !== 'string') {
    throw new Error(
      'view source: `from` must be a `@id` ref string (e.g. `@my-source`)',
    );
  }
  const match = VIEW_REF_PREFIX.exec(input.from);
  if (!match) {
    throw new Error(
      `view source: \`from\` entry ${JSON.stringify(input.from)} must be a \`@id\` ref (e.g. \`@my-source\`)`,
    );
  }
  const ref = match[1];
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
    from: ref,
  };
  if (hasQuery) out.query = input.query;
  if (hasQueryFile) out.queryFile = input.queryFile;
  if (input.cache !== undefined) {
    out.cache = parseViewCache(input.id, input.cache);
  }
  const defaultMarker = pickDefault(input);
  if (defaultMarker.default) out.default = true;
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

export interface ParseSourceSpecsContext extends ParseSourceSpecContext {
  /** Per-input human-readable location string for collision diagnostics. */
  locations?: ReadonlyArray<string>;
}

export function parseSourceSpecs(
  inputs: ReadonlyArray<SourceSpecInput>,
  ctx?: ParseSourceSpecsContext,
): ParsedSource[] {
  const parsed = inputs.map((input) =>
    parseSourceSpec(input, { transformRegistry: ctx?.transformRegistry }),
  );
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
  const defaultIndices: number[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i] as { default?: true; kind: ParsedSource['kind'] };
    if (entry.default === true) {
      if (entry.kind === 'reference') {
        throw new Error(
          `\`default: true\` is not valid on \`kind: 'reference'\` (alias) at ${locationFor(i)}`,
        );
      }
      defaultIndices.push(i);
    }
  }
  if (defaultIndices.length > 1) {
    const locs = defaultIndices.map(locationFor).join(', ');
    throw new Error(
      `more than one source entry carries \`default: true\` (${locs}); at most one entry may be marked default`,
    );
  }
  return parsed;
}
