import type { GraphMode } from './rdf-loader';

export interface SourceSpecCommonFields {
  id?: string;
  graphMode?: GraphMode;
  graph?: string;
  prefilter?: string;
  prefilterFile?: string;
}

export interface ParsedGlobSource extends SourceSpecCommonFields {
  kind: 'glob';
  glob: string;
}

export interface ParsedEndpointSource extends SourceSpecCommonFields {
  kind: 'endpoint';
  endpoint: string;
}

export interface ParsedReferenceSource extends SourceSpecCommonFields {
  kind: 'reference';
  ref: string;
}

export type ParsedSource =
  | ParsedGlobSource
  | ParsedEndpointSource
  | ParsedReferenceSource;

export interface SourceSpecObjectInput extends SourceSpecCommonFields {
  glob?: string;
  endpoint?: string;
}

export type SourceSpecInput = string | SourceSpecObjectInput;

const HTTP_PREFIX = /^https?:\/\//;
const REFERENCE_PREFIX = /^@(.+)$/;
export const SOURCE_ID_REGEX = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/;

const COMMON_FIELD_KEYS = [
  'id',
  'graphMode',
  'graph',
  'prefilter',
  'prefilterFile',
] as const satisfies ReadonlyArray<keyof SourceSpecCommonFields>;

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
  if (hasGlob === hasEndpoint) {
    throw new Error(
      'source-spec object must declare exactly one of `glob:` or `endpoint:`',
    );
  }
  if (input.id !== undefined) validateSourceId(input.id);
  const common = pickCommon(input);
  if (hasGlob) {
    return { kind: 'glob', glob: input.glob as string, ...common };
  }
  return { kind: 'endpoint', endpoint: input.endpoint as string, ...common };
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
