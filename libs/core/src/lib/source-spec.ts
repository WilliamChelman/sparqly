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

export interface ParsedViewSource {
  kind: 'view';
  id: string;
  from: ReadonlyArray<string>;
  query?: string;
  queryFile?: string;
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

export interface ParseSourceSpecsContext {
  /** Per-input human-readable location string for collision diagnostics. */
  locations?: ReadonlyArray<string>;
}

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
  return parsed;
}
