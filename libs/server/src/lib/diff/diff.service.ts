import { Injectable } from '@nestjs/common';
import {
  detectSelectShape,
  diffStores,
  extractAnnotationPredicates,
  formatRawPassThroughRejection,
  groupRdfDiffByEntity,
  resolveAnonymousSelectBindings,
  resolveAnonymousView,
  storageTier,
  tabularDiff,
  type DiffError,
  type HunkedRdfDiff,
  type ParsedSource,
  type RawPassThroughTargetError,
  type SelectShapeReport,
  type SourceError,
  type SourceRecordSidecar,
  type SourceSpecInput,
  type TabularDiffResult,
  type TabularRow,
} from 'core';
import {
  ResultAsync,
  err,
  ok,
  safeTry,
  type Result,
  type ResultAsync as ResultAsyncT,
} from 'neverthrow';
import type { Store } from 'n3';
import type { EngineMap } from '../bootstrap';
import { applyAddressPin, loadSideSources, parsePinnedInput } from './side-sources';

export interface DiffRequest {
  left: string;
  right: string;
  leftQuery?: string;
  rightQuery?: string;
}

export interface GroupedDiffResponse {
  kind: 'grouped';
  hunked: HunkedRdfDiff;
}

export interface TabularDiffResponse {
  kind: 'tabular';
  diff: TabularDiffResult;
  totals: { left: number; right: number };
  variables: string[];
}

export interface DiffErrorResponse {
  kind: 'error';
  errors: { left?: DiffError; right?: DiffError; top?: DiffError };
}

export type DiffResponse =
  | GroupedDiffResponse
  | TabularDiffResponse
  | DiffErrorResponse;

@Injectable()
export class DiffService {
  constructor(
    private readonly engineMap: EngineMap,
    // Walked for `from:` chains while resolving anonymous SELECTs.
    private readonly resolutionRegistry: ReadonlyArray<ParsedSource> = [],
  ) {}

  async runDiff(req: DiffRequest): Promise<DiffResponse> {
    const leftSel = this.selectFromRegistry(req.left, 'left');
    const rightSel = this.selectFromRegistry(req.right, 'right');
    if (leftSel.isErr() || rightSel.isErr()) {
      return packageSideErrors(leftSel, rightSel);
    }

    const dispatch = detectTabularDispatch(req.leftQuery, req.rightQuery);
    if (dispatch.isErr()) {
      return { kind: 'error', errors: { top: dispatch.error } };
    }

    if (dispatch.value.kind === 'tabular') {
      return runTabular({
        leftTarget: leftSel.value,
        rightTarget: rightSel.value,
        leftQuery: req.leftQuery as string,
        rightQuery: req.rightQuery as string,
        leftShape: dispatch.value.left,
        rightShape: dispatch.value.right,
        registry: this.resolutionRegistry,
      });
    }

    return runGraph({
      engineMap: this.engineMap,
      resolutionRegistry: this.resolutionRegistry,
      leftTarget: leftSel.value,
      rightTarget: rightSel.value,
      leftQuery: req.leftQuery,
      rightQuery: req.rightQuery,
    });
  }

  private selectFromRegistry(
    raw: string,
    side: 'left' | 'right',
  ): Result<ParsedSource, DiffError> {
    const { id, pin } = parsePinnedInput(raw);
    const found = this.engineMap.getSource(id);
    if (!found || found.kind === 'reference') {
      return err({
        kind: 'target',
        side,
        target: {
          kind: 'unknown-ref',
          ref: raw.startsWith('@') ? raw : `@${raw}`,
          availableIds: this.engineMap.allIds(),
        },
      });
    }
    return ok(pin === undefined ? found : applyAddressPin(found, pin));
  }
}

function packageSideErrors(
  left: Result<ParsedSource, DiffError>,
  right: Result<ParsedSource, DiffError>,
): DiffErrorResponse {
  const errors: DiffErrorResponse['errors'] = {};
  if (left.isErr()) errors.left = left.error;
  if (right.isErr()) errors.right = right.error;
  return { kind: 'error', errors };
}

type TabularDispatch =
  | { kind: 'graph-mode' }
  | { kind: 'tabular'; left: SelectShapeReport; right: SelectShapeReport };

function detectTabularDispatch(
  leftQuery: string | undefined,
  rightQuery: string | undefined,
): Result<TabularDispatch, DiffError> {
  if (leftQuery === undefined || rightQuery === undefined) {
    return ok({ kind: 'graph-mode' });
  }
  let left: SelectShapeReport;
  let right: SelectShapeReport;
  try {
    left = detectSelectShape(leftQuery);
    right = detectSelectShape(rightQuery);
  } catch {
    // Parse-error on either query: fall back to graph mode so the offending
    // query is surfaced downstream as an anonymous-view-execution error
    // (per-side) rather than a top-level shape error here.
    return ok({ kind: 'graph-mode' });
  }
  if (left.shape === 'triples' && right.shape === 'triples') {
    return ok({ kind: 'graph-mode' });
  }
  if (left.shape !== right.shape) {
    const tuplesSide = left.shape === 'tuples' ? 'left' : 'right';
    const triplesSide = tuplesSide === 'left' ? 'right' : 'left';
    return err({ kind: 'mixed-shape', triplesSide, tuplesSide });
  }
  return ok({ kind: 'tabular', left, right });
}

interface RunGraphArgs {
  engineMap: EngineMap;
  resolutionRegistry: ReadonlyArray<ParsedSource>;
  leftTarget: ParsedSource;
  rightTarget: ParsedSource;
  leftQuery: string | undefined;
  rightQuery: string | undefined;
}

interface GraphSideOk {
  store: Store;
  sourceRecords?: SourceRecordSidecar;
  annotationPredicates: ReturnType<typeof extractAnnotationPredicates>;
}

async function runGraph(args: RunGraphArgs): Promise<DiffResponse> {
  const [left, right] = await Promise.all([
    resolveGraphSide(args.engineMap, args.resolutionRegistry, args.leftTarget, args.leftQuery, 'left'),
    resolveGraphSide(args.engineMap, args.resolutionRegistry, args.rightTarget, args.rightQuery, 'right'),
  ]);
  if (left.isErr() || right.isErr()) {
    const errors: DiffErrorResponse['errors'] = {};
    if (left.isErr()) errors.left = left.error;
    if (right.isErr()) errors.right = right.error;
    return { kind: 'error', errors };
  }

  const result = await diffStores(
    {
      store: left.value.store,
      annotationPredicates: left.value.annotationPredicates,
      sourceRecords: left.value.sourceRecords,
    },
    {
      store: right.value.store,
      annotationPredicates: right.value.annotationPredicates,
      sourceRecords: right.value.sourceRecords,
    },
  );

  const hunked = groupRdfDiffByEntity({
    diff: result,
    left: { store: left.value.store, sourceRecords: left.value.sourceRecords },
    right: { store: right.value.store, sourceRecords: right.value.sourceRecords },
  });

  return { kind: 'grouped', hunked };
}

function resolveGraphSide(
  engineMap: EngineMap,
  resolutionRegistry: ReadonlyArray<ParsedSource>,
  target: ParsedSource,
  inlineQuery: string | undefined,
  side: 'left' | 'right',
): ResultAsyncT<GraphSideOk, DiffError> {
  return safeTry(async function* () {
    if (inlineQuery !== undefined) {
      const upstream = yield* anonymousUpstream(target, side).safeUnwrap();
      const store = yield* resolveAnonymousViewAsync(upstream, inlineQuery, side).safeUnwrap();
      return ok<GraphSideOk, DiffError>({
        store,
        annotationPredicates: extractAnnotationPredicates(undefined),
      });
    }

    const rawRejection = rawPassThroughRejection(target, side);
    if (rawRejection !== undefined) {
      return err<GraphSideOk, DiffError>({
        kind: 'source',
        side,
        source: rawRejection,
      });
    }

    if (target.id === undefined) {
      return err<GraphSideOk, DiffError>({
        kind: 'inline-upstream-kind',
        side,
        targetKind: target.kind,
      });
    }

    const sources = yield* loadSideSources(
      engineMap,
      resolutionRegistry,
      target,
    )
      .mapErr((source: SourceError): DiffError => ({ kind: 'source', side, source }))
      .safeUnwrap();
    if (sources.mode === 'pass-through') {
      // Unreachable: the raw-pass-through pre-check above rejects raw
      // endpoint targets before this branch; view-over-endpoint resolves
      // to a materialized store, not pass-through.
      throw new Error(
        'resolveGraphSide: unexpected pass-through resolution after raw-target pre-check',
      );
    }
    return ok<GraphSideOk, DiffError>({
      store: sources.store,
      sourceRecords: sources.sourceRecords,
      annotationPredicates: extractAnnotationPredicates(undefined),
    });
  });
}

function resolveAnonymousViewAsync(
  upstream: SourceSpecInput,
  query: string,
  side: 'left' | 'right',
): ResultAsyncT<Store, DiffError> {
  return ResultAsync.fromPromise(
    resolveAnonymousView({ source: upstream, query }),
    (raw): DiffError => ({
      kind: 'anonymous-view-execution',
      side,
      message: raw instanceof Error ? raw.message : String(raw),
    }),
  );
}

interface RunTabularArgs {
  leftTarget: ParsedSource;
  rightTarget: ParsedSource;
  leftQuery: string;
  rightQuery: string;
  leftShape: SelectShapeReport;
  rightShape: SelectShapeReport;
  registry: ReadonlyArray<ParsedSource>;
}

async function runTabular(args: RunTabularArgs): Promise<DiffResponse> {
  const leftSet = new Set(args.leftShape.variables);
  const rightSet = new Set(args.rightShape.variables);
  const setsMatch =
    leftSet.size === rightSet.size &&
    [...leftSet].every((v) => rightSet.has(v));
  if (!setsMatch) {
    return {
      kind: 'error',
      errors: {
        top: {
          kind: 'set-mismatch',
          left: [...leftSet],
          right: [...rightSet],
        },
      },
    };
  }

  const leftUpstream = anonymousUpstream(args.leftTarget, 'left');
  const rightUpstream = anonymousUpstream(args.rightTarget, 'right');
  if (leftUpstream.isErr() || rightUpstream.isErr()) {
    const errors: DiffErrorResponse['errors'] = {};
    if (leftUpstream.isErr()) errors.left = leftUpstream.error;
    if (rightUpstream.isErr()) errors.right = rightUpstream.error;
    return { kind: 'error', errors };
  }

  const sources: SourceSpecInput[] = [...args.registry] as SourceSpecInput[];
  const [leftBindings, rightBindings] = await Promise.all([
    resolveTabularSide(leftUpstream.value, args.leftQuery, sources, 'left'),
    resolveTabularSide(rightUpstream.value, args.rightQuery, sources, 'right'),
  ]);
  if (leftBindings.isErr() || rightBindings.isErr()) {
    const errors: DiffErrorResponse['errors'] = {};
    if (leftBindings.isErr()) errors.left = leftBindings.error;
    if (rightBindings.isErr()) errors.right = rightBindings.error;
    return { kind: 'error', errors };
  }

  const variables = [...args.rightShape.variables];
  const leftKeyed = firstBlankNodeColumn(leftBindings.value.rows, variables);
  const rightKeyed = firstBlankNodeColumn(rightBindings.value.rows, variables);
  if (leftKeyed !== undefined || rightKeyed !== undefined) {
    const errors: DiffErrorResponse['errors'] = {};
    if (leftKeyed !== undefined) errors.left = leftKeyed;
    if (rightKeyed !== undefined) errors.right = rightKeyed;
    return { kind: 'error', errors };
  }

  const tab = tabularDiff(
    leftBindings.value.rows,
    rightBindings.value.rows,
    variables,
  );
  if (tab.isErr()) {
    // Unreachable: per-side firstBlankNodeColumn intercepts every blank-node
    // column before tabularDiff sees it. The check satisfies type exhaustion.
    return { kind: 'error', errors: { top: tab.error } };
  }
  return {
    kind: 'tabular',
    diff: tab.value,
    totals: tab.value.totals,
    variables,
  };
}

// Per-side pre-check so a blank-node-keying failure can be attributed to left
// or right; tabularDiff sees both bags merged and cannot tell sides apart.
function firstBlankNodeColumn(
  rows: ReadonlyArray<TabularRow>,
  variables: ReadonlyArray<string>,
): DiffError | undefined {
  const single = tabularDiff(rows, [], variables);
  if (single.isErr()) return single.error;
  return undefined;
}

function anonymousUpstream(
  target: ParsedSource,
  side: 'left' | 'right',
): Result<SourceSpecInput, DiffError> {
  if (target.kind === 'glob') return ok(target.glob);
  if (target.kind === 'file') return ok(target.path);
  if (target.kind === 'endpoint') return ok(target.endpoint);
  return err({ kind: 'inline-upstream-kind', side, targetKind: target.kind });
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

function resolveTabularSide(
  upstream: SourceSpecInput,
  query: string,
  registry: ReadonlyArray<SourceSpecInput>,
  side: 'left' | 'right',
): ResultAsyncT<{ rows: TabularRow[] }, DiffError> {
  return ResultAsync.fromPromise(
    resolveAnonymousSelectBindings({
      source: upstream,
      query,
      registry: [...registry],
    }),
    (raw): DiffError => ({
      kind: 'anonymous-select-execution',
      side,
      message: raw instanceof Error ? raw.message : String(raw),
    }),
  ).map((result) => ({ rows: result.rows }));
}

