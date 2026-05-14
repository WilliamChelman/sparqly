import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { type Store } from 'n3';
import type { SparqlyLogger } from 'common';
import {
  extractAnnotationPredicates,
  hasAnnotateTransform,
  parseSourceSpecs,
  resolveAnonymousView,
  resolveSource,
  selectTarget,
  withAutoSourceAnnotation,
  type AnnotationPredicateIris,
  type ParsedSource,
  type SourceSpecInput,
} from 'core';
import { DiffErrorSignal } from '../diff-error';
import type { DiffConfig } from './diff';

export interface SideResolved {
  fileCount: number;
  store: Store;
  prefixes: Record<string, Record<string, string>>;
  annotationPredicates: AnnotationPredicateIris;
  annotated: boolean;
}

export function resolveDiffSide(
  config: DiffConfig,
  side: 'left' | 'right',
): ParsedSource {
  const registry = parseSourceSpecs(config.sources ?? []);
  const value = config[side];
  const targetArg = typeof value === 'string' ? value : undefined;
  if (value !== undefined && targetArg === undefined) {
    return parseSourceSpecs([value])[0];
  }
  return selectTarget(registry, targetArg);
}

export function anonymousUpstream(
  target: ParsedSource,
  side: 'left' | 'right',
): SourceSpecInput {
  if (target.kind === 'glob') return target.glob;
  if (target.kind === 'endpoint') return target.endpoint;
  throw new DiffErrorSignal({
    kind: 'inline-upstream-kind',
    side,
    targetKind: target.kind,
  });
}

export async function resolveSide(
  rawTarget: ParsedSource,
  config: DiffConfig,
  inlineQuery: string | undefined,
  side: 'left' | 'right',
  logger: SparqlyLogger,
): Promise<SideResolved> {
  const target = withAutoSourceAnnotation(rawTarget, {
    skipAuto: config.skipAutoSourceAnnotation === true,
  });
  if (inlineQuery !== undefined) {
    const upstream = anonymousUpstream(target, side);
    const store = await resolveAnonymousView({
      source: upstream,
      query: inlineQuery,
      logger,
    });
    return {
      fileCount: 0,
      store,
      prefixes: {},
      annotationPredicates: extractAnnotationPredicates(undefined),
      annotated: false,
    };
  }

  if (target.kind === 'endpoint') {
    throw new DiffErrorSignal({
      kind: 'endpoint-as-diff-target',
      side,
      endpoint: target.endpoint,
    });
  }

  const registry = parseSourceSpecs(config.sources ?? []);
  const sources = await resolveSource(target, { registry, logger });
  if (sources.mode === 'pass-through') {
    throw new DiffErrorSignal({
      kind: 'endpoint-as-diff-target',
      side,
      endpoint: sources.endpoint.endpoint,
    });
  }
  const transforms = target.kind === 'glob' ? target.transforms : undefined;
  return {
    fileCount: sources.files.length,
    store: sources.store,
    prefixes: sources.prefixes,
    annotationPredicates: extractAnnotationPredicates(transforms),
    annotated: hasAnnotateTransform(transforms),
  };
}

export async function loadSymmetricInlineScopeQuery(
  config: DiffConfig,
): Promise<string | undefined> {
  if (typeof config.query === 'string') return config.query;
  if (typeof config.queryFile === 'string') {
    const path = resolvePath(process.cwd(), config.queryFile);
    return readFile(path, 'utf8');
  }
  return undefined;
}

export async function loadSideInlineScopeQuery(
  symmetric: string | undefined,
  sideQuery: string | undefined,
  sideQueryFile: string | undefined,
): Promise<string | undefined> {
  if (typeof sideQuery === 'string') return sideQuery;
  if (typeof sideQueryFile === 'string') {
    const path = resolvePath(process.cwd(), sideQueryFile);
    return readFile(path, 'utf8');
  }
  return symmetric;
}
