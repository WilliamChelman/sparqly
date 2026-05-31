import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { type Store } from 'n3';
import type { SparqlyLogger } from 'common';
import {
  extractAnnotationPredicates,
  formatRawPassThroughRejection,
  formatSourceError,
  parseSourceSpecs,
  resolveInlineQueryResult,
  resolveSource,
  selectTarget,
  storageTier,
  type AnnotationPredicateIris,
  type ParsedSource,
  type RawPassThroughTargetError,
  type SourceRecordSidecar,
  type SourceSpecInput,
} from 'core';
import { DiffErrorSignal } from '../diff-error';
import { applyAtOverride, splitPositionalAddress } from '../at-override';
import type { DiffConfig } from './diff';

export interface SideResolved {
  fileCount: number;
  store: Store;
  prefixes: Record<string, Record<string, string>>;
  annotationPredicates: AnnotationPredicateIris;
  sourceRecords?: SourceRecordSidecar;
  annotated: boolean;
}

export function resolveDiffSide(
  config: DiffConfig,
  side: 'left' | 'right',
  registry?: ReadonlyArray<ParsedSource>,
): ParsedSource {
  const effective = registry ?? parseSourceSpecs(config.sources ?? []);
  const value = config[side];
  const rawArg = typeof value === 'string' ? value : undefined;
  if (value !== undefined && rawArg === undefined) {
    return parseSourceSpecs([value])[0];
  }
  const { targetArg, positionalRef } = splitPositionalAddress(rawArg);
  const target = selectTarget(effective, targetArg);
  return positionalRef === undefined
    ? target
    : applyAtOverride(target, positionalRef);
}

export function inlineQueryUpstream(
  target: ParsedSource,
  side: 'left' | 'right',
): SourceSpecInput {
  if (target.kind === 'glob') return target.glob;
  if (target.kind === 'file') return target.path;
  if (target.kind === 'endpoint') return target.endpoint;
  throw new DiffErrorSignal({
    kind: 'inline-upstream-kind',
    side,
    targetKind: target.kind,
  });
}

export async function resolveSide(
  target: ParsedSource,
  config: DiffConfig,
  inlineQuery: string | undefined,
  side: 'left' | 'right',
  logger: SparqlyLogger,
): Promise<SideResolved> {
  if (inlineQuery !== undefined) {
    const upstream = inlineQueryUpstream(target, side);
    const resolved = await resolveInlineQueryResult({
      source: upstream,
      query: inlineQuery,
      logger,
    });
    if (resolved.isErr()) {
      throw new DiffErrorSignal({
        kind: 'anonymous-view-execution',
        side,
        message: formatSourceError(resolved.error),
      });
    }
    return {
      fileCount: 0,
      store: resolved.value,
      prefixes: {},
      annotationPredicates: extractAnnotationPredicates(undefined),
      annotated: false,
    };
  }

  const rawRejection = rawPassThroughRejection(target, side);
  if (rawRejection !== undefined) {
    throw new DiffErrorSignal({ kind: 'source', side, source: rawRejection });
  }

  const sources = await resolveSource(target, {
    logger,
  });
  if (sources.mode === 'pass-through' || sources.mode === 'disk-backed') {
    // Unreachable in practice — the pre-check above blocks the only targets
    // that reach these resolution modes. Guard kept so the type narrowing
    // below (sources.mode === 'materialized') stays exhaustive.
    if (sources.mode === 'disk-backed') await sources.close();
    throw new Error(
      `resolveSide: unexpected resolution mode "${sources.mode}" reached after raw-target pre-check`,
    );
  }
  const transforms =
    target.kind === 'glob' || target.kind === 'file'
      ? target.transforms
      : undefined;
  return {
    fileCount: sources.files.length,
    store: sources.store,
    prefixes: sources.prefixes,
    annotationPredicates: extractAnnotationPredicates(transforms),
    sourceRecords: sources.sourceRecords,
    annotated: sources.sourceRecords !== undefined,
  };
}

function rawPassThroughRejection(
  target: ParsedSource,
  side: 'left' | 'right',
): RawPassThroughTargetError | undefined {
  const source = rawPassThroughSource(target);
  if (source === undefined) return undefined;
  return {
    kind: 'raw-pass-through-target',
    source,
    message: formatRawPassThroughRejection(source, { side }),
  };
}

function rawPassThroughSource(
  target: ParsedSource,
): RawPassThroughTargetError['source'] | undefined {
  if (target.kind === 'endpoint') {
    return { kind: 'endpoint', url: target.endpoint };
  }
  if (target.kind === 'glob' && storageTier(target) === 'disk') {
    return {
      kind: 'disk-backed-glob',
      label: target.id !== undefined ? `@${target.id}` : target.glob,
    };
  }
  if (target.kind === 'file' && storageTier(target) === 'disk') {
    return {
      kind: 'disk-backed-glob',
      label: target.id !== undefined ? `@${target.id}` : target.path,
    };
  }
  return undefined;
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
