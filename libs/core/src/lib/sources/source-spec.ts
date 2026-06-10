import { TRANSFORM_REGISTRY } from './transform-registry';
import {
  parseTransformList,
  type ParsedTransform,
  type TransformDefinition,
} from './transform-spec';
import {
  pickEndpointHttp,
  rejectEndpointOnlyFields,
  rejectLegacyEndpointGraphFields,
} from './source-spec-endpoint';
import {
  pickUnionDefaultGraph,
  rejectUnionDefaultGraphOn,
} from './union-default-graph';
import { pickGitFields, rejectGitRefOn } from './source-spec-git';
import {
  pickStorage,
  rejectAnnotateSourceOnDiskGlob,
  rejectStorageOn,
  type StorageTier,
} from './glob-storage';

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
  transforms?: ParsedTransform[];
  splitByFile?: true;
  unionDefaultGraph?: boolean;
  storage?: StorageTier;
  /** Non-empty ref string; resolved to a SHA at expand/load time, not parse time. */
  gitRef?: string;
  /** Repo discovery override, relative to the project config dir; requires `gitRef`. */
  gitRoot?: string;
  /**
   * 40-char commit SHA that `gitRef` resolved to. Set by `pinGlobSource`, never
   * by the parser. View-cache fingerprints substitute this for `gitRef`/`gitRoot`
   * so two pins onto the same commit share cache entries.
   */
  resolvedSha?: string;
}

/**
 * Synthesized child of a split-glob meta. Produced by `expandSplitGlobs`, never
 * by `parseSourceSpec`. The `id` is `<parentId>/<glob-relative-path>` and matches
 * {@link SYNTHESIZED_SOURCE_ID_REGEX}, not the stricter user-id regex.
 */
export interface ParsedFileSource extends SourceSpecCommonFields {
  kind: 'file';
  id: string;
  path: string;
  parentId: string;
  transforms?: ParsedTransform[];
  unionDefaultGraph?: boolean;
  storage?: StorageTier;
  gitRef?: string;
  /** Propagated alongside `gitRef` so the file loader does not re-walk discovery. */
  repoRoot?: string;
  resolvedSha?: string;
}

export interface ParsedEndpointSource
  extends SourceSpecCommonFields,
    EndpointHttpFields,
    DefaultMarkerField {
  kind: 'endpoint';
  endpoint: string;
  /**
   * Opt-in to the Query cache (ADR-0054). Present only as `true`; absent means
   * not opted in. The object form (`{ ttl, maxBytes }`) lands in a later slice.
   */
  queryCache?: true;
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

export type ParsedSource =
  | ParsedGlobSource
  | ParsedEndpointSource
  | ParsedReferenceSource
  | ParsedEmptySource
  | ParsedFileSource;

export interface SourceSpecObjectInput
  extends SourceSpecCommonFields,
    EndpointHttpFields {
  glob?: string;
  endpoint?: string;
  empty?: true;
  default?: true;
  transforms?: ReadonlyArray<unknown>;
  splitByFile?: true;
  unionDefaultGraph?: boolean;
  storage?: StorageTier;
  gitRef?: string;
  gitRoot?: string;
  queryCache?: boolean;
}

export type SourceSpecInput = string | SourceSpecObjectInput;

const HTTP_PREFIX = /^https?:\/\//;
const REFERENCE_PREFIX = /^@(.+)$/;
export const SOURCE_ID_REGEX = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/;
/**
 * Looser id regex for synthesized file children: one parent segment matching
 * {@link SOURCE_ID_REGEX}, followed by one or more `/`-joined segments.
 * User-declared ids must still match {@link SOURCE_ID_REGEX}.
 */
export const SYNTHESIZED_SOURCE_ID_REGEX =
  /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)+$/;

const COMMON_FIELD_KEYS = ['id'] as const satisfies ReadonlyArray<
  keyof SourceSpecCommonFields
>;

function pickDefault(input: SourceSpecObjectInput): DefaultMarkerField {
  if (input.default === undefined) return {};
  if (input.default !== true) {
    throw new Error('`default` must be `true` (omit the field otherwise)');
  }
  return { default: true };
}

function pickSplitByFile(input: SourceSpecObjectInput): { splitByFile?: true } {
  if (input.splitByFile === undefined) return {};
  if (input.splitByFile !== true) {
    throw new Error('`splitByFile` must be `true` (omit the field otherwise)');
  }
  return { splitByFile: true };
}

function rejectSplitByFileOn(
  input: SourceSpecObjectInput,
  kind: 'endpoint' | 'empty',
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
    throw new Error(
      `source id ${JSON.stringify(id)} must not start with \`@\``,
    );
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
  const hasEmpty = input.empty === true;
  const setCount = [hasGlob, hasEndpoint, hasEmpty].filter(Boolean).length;
  if (setCount !== 1) {
    throw new Error(
      'source-spec object must declare exactly one of `glob:`, `endpoint:`, or `empty:`',
    );
  }
  if (input.id !== undefined) validateSourceId(input.id);
  if (hasEmpty) {
    rejectSplitByFileOn(input, 'empty');
    rejectUnionDefaultGraphOn(input, 'empty');
    rejectStorageOn(input, 'empty');
    return parseEmpty(input);
  }
  const common = pickCommon(input);
  const defaultMarker = pickDefault(input);
  if (hasGlob) {
    rejectEndpointOnlyFields(input);
    rejectLegacyGlobGraphFields(input);
    const registry = ctx?.transformRegistry ?? TRANSFORM_REGISTRY;
    const transforms =
      input.transforms === undefined
        ? undefined
        : parseTransformList(input.transforms, registry);
    const splitByFileField = pickSplitByFile(input);
    const unionDefaultGraphField = pickUnionDefaultGraph(input);
    const storageField = pickStorage(input);
    rejectAnnotateSourceOnDiskGlob(storageField.storage, transforms);
    const gitFields = pickGitFields(input);
    return {
      kind: 'glob',
      glob: input.glob as string,
      ...common,
      ...(transforms === undefined ? {} : { transforms }),
      ...splitByFileField,
      ...unionDefaultGraphField,
      ...storageField,
      ...gitFields,
      ...defaultMarker,
    };
  }
  rejectLegacyEndpointGraphFields(input);
  rejectTransformsOn(input, 'endpoint');
  rejectSplitByFileOn(input, 'endpoint');
  rejectUnionDefaultGraphOn(input, 'endpoint');
  rejectStorageOn(input, 'endpoint');
  rejectGitRefOn(input, 'endpoint');
  const http = pickEndpointHttp(input);
  return {
    kind: 'endpoint',
    endpoint: input.endpoint as string,
    ...common,
    ...http,
    ...pickQueryCache(input),
    ...defaultMarker,
  };
}

/**
 * Slice 1 of the Query cache (ADR-0054) accepts only `queryCache: true | false`.
 * The object form (`{ ttl, maxBytes }`) is rejected until a later slice honors
 * it, so a config that sets it fails loudly rather than silently ignoring knobs.
 */
function pickQueryCache(input: SourceSpecObjectInput): { queryCache?: true } {
  const value = input.queryCache;
  if (value === undefined || value === false) return {};
  if (value !== true) {
    throw new Error(
      '`queryCache` must be a boolean (the `{ ttl, maxBytes }` form is not supported yet)',
    );
  }
  return { queryCache: true };
}

function rejectTransformsOn(
  input: SourceSpecObjectInput,
  kind: 'endpoint' | 'empty',
): void {
  if (input.transforms !== undefined) {
    throw new Error(
      `\`transforms\` is only valid on glob sources (got a ${kind} source)`,
    );
  }
}

const EMPTY_FORBIDDEN_KEYS = [
  ...LEGACY_GLOB_GRAPH_FIELD_KEYS,
  'auth',
  'headers',
  'timeoutMs',
  'transforms',
  'gitRef',
  'gitRoot',
] as const;

function parseEmpty(input: SourceSpecObjectInput): ParsedEmptySource {
  if (input.id === undefined) {
    throw new Error('empty source: `id` is required');
  }
  for (const key of EMPTY_FORBIDDEN_KEYS) {
    if ((input as Record<string, unknown>)[key] !== undefined) {
      throw new Error(`empty source: \`${key}\` is not valid on empty sources`);
    }
  }
  const defaultMarker = pickDefault(input);
  return { kind: 'empty', id: input.id, ...defaultMarker };
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
