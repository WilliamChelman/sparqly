import { TRANSFORM_REGISTRY } from './transform-registry';
import {
  parseTransformList,
  type ParsedTransform,
  type TransformDefinition,
} from './transform-spec';
import {
  parseViewCache,
  type ParsedViewCache,
  type ViewCacheInput,
} from './view-cache-spec';

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
  /**
   * Opt-in flag for split-glob expansion (ADR-0027). When `true`, a downstream
   * pass (`expandSplitGlobs`) walks the filesystem and synthesizes one
   * `kind: 'file'` child per matched file alongside this meta. Parsing alone
   * never performs the expansion; this field is only carried through.
   */
  splitByFile?: true;
}

/**
 * Synthesized child source representing one file matched by a split-glob meta
 * (ADR-0027). Never produced by `parseSourceSpec`/`parseSourceSpecs` — only by
 * `expandSplitGlobs`. The `id` is `<parentId>/<glob-relative-path>` and matches
 * {@link SYNTHESIZED_SOURCE_ID_REGEX}, not the stricter user-id regex.
 */
export interface ParsedFileSource extends SourceSpecCommonFields {
  kind: 'file';
  id: string;
  path: string;
  parentId: string;
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

export interface ParsedViewSource extends DefaultMarkerField {
  kind: 'view';
  id: string;
  from: string;
  query?: string;
  queryFile?: string;
  cache?: ParsedViewCache;
}

export type ParsedSource =
  | ParsedGlobSource
  | ParsedEndpointSource
  | ParsedReferenceSource
  | ParsedViewSource
  | ParsedEmptySource
  | ParsedFileSource;

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
  /** Opt-in split-glob expansion flag — only valid on glob inputs (ADR-0027). */
  splitByFile?: true;
}

export type SourceSpecInput = string | SourceSpecObjectInput;

const HTTP_PREFIX = /^https?:\/\//;
const REFERENCE_PREFIX = /^@(.+)$/;
export const SOURCE_ID_REGEX = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/;
/**
 * Looser id regex for synthesized file children (ADR-0027): one parent
 * segment matching {@link SOURCE_ID_REGEX}, followed by one or more
 * `/`-joined segments. User-declared ids must still match {@link SOURCE_ID_REGEX}.
 */
export const SYNTHESIZED_SOURCE_ID_REGEX =
  /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)+$/;

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

function pickSplitByFile(
  input: SourceSpecObjectInput,
): { splitByFile?: true } {
  if (input.splitByFile === undefined) return {};
  if (input.splitByFile !== true) {
    throw new Error(
      '`splitByFile` must be `true` (omit the field otherwise)',
    );
  }
  return { splitByFile: true };
}

function rejectSplitByFileOn(
  input: SourceSpecObjectInput,
  kind: 'endpoint' | 'view' | 'empty',
): void {
  if (input.splitByFile !== undefined) {
    throw new Error(
      `\`splitByFile\` is only valid on glob sources (got a ${kind} source)`,
    );
  }
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
    rejectSplitByFileOn(input, 'view');
    return parseView(input);
  }
  if (hasEmpty) {
    rejectSplitByFileOn(input, 'empty');
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
    const splitByFileField = pickSplitByFile(input);
    return {
      kind: 'glob',
      glob: input.glob as string,
      ...common,
      ...transformsField,
      ...splitByFileField,
      ...defaultMarker,
    };
  }
  rejectLegacyEndpointGraphFields(input);
  rejectTransformsOn(input, 'endpoint');
  rejectSplitByFileOn(input, 'endpoint');
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

/**
 * Synthesis-bug guard for split-glob children (ADR-0027). The expansion pass
 * (`expandSplitGlobs`) calls this on every synthesized {@link ParsedFileSource}
 * to assert the child's shape never carries a `default: true` marker and that
 * its id matches {@link SYNTHESIZED_SOURCE_ID_REGEX}. A failure here is a bug
 * in the synthesizer, not user error.
 */
export function validateSynthesizedFileSource(source: ParsedFileSource): void {
  const withDefault = source as ParsedFileSource & { default?: unknown };
  if (withDefault.default !== undefined) {
    throw new Error(
      `synthesis bug: a synthesized file child must never carry \`default\` (id ${JSON.stringify(source.id)})`,
    );
  }
  if (!SYNTHESIZED_SOURCE_ID_REGEX.test(source.id)) {
    throw new Error(
      `synthesis bug: synthesized file child id ${JSON.stringify(source.id)} must match ${SYNTHESIZED_SOURCE_ID_REGEX}`,
    );
  }
}
