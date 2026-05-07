import { Injectable } from '@nestjs/common';
import {
  detectSelectShape,
  diffStores,
  extractAnnotationPredicates,
  resolveAnonymousSelectBindings,
  resolveAnonymousView,
  resolveSource,
  tabularDiff,
  withAutoSourceAnnotation,
  type ParsedSource,
  type RdfDiffResult,
  type SelectShapeReport,
  type SourceRecord,
  type SourceSpecInput,
  type TabularDiffResult,
  type TabularRow,
} from 'core';
import type { Store } from 'n3';

export interface DiffRequest {
  left: string;
  right: string;
  leftQuery?: string;
  rightQuery?: string;
  skipAutoSourceAnnotation?: boolean;
}

export interface GraphDiffResponse {
  kind: 'graph';
  diff: RdfDiffResult;
  sourceRecords: {
    left: Record<string, SourceRecord[]>;
    right: Record<string, SourceRecord[]>;
  };
  totals: { left: number; right: number };
}

export interface TabularDiffResponse {
  kind: 'tabular';
  diff: TabularDiffResult;
  totals: { left: number; right: number };
  variables: string[];
}

export interface DiffErrorResponse {
  kind: 'error';
  errors: { left?: string; right?: string; top?: string };
}

export type DiffResponse =
  | GraphDiffResponse
  | TabularDiffResponse
  | DiffErrorResponse;

@Injectable()
export class DiffService {
  constructor(private readonly registry: ReadonlyArray<ParsedSource>) {}

  async runDiff(req: DiffRequest): Promise<DiffResponse> {
    const leftSel = this.selectFromRegistry(req.left, 'left');
    const rightSel = this.selectFromRegistry(req.right, 'right');
    if (leftSel.kind === 'err' || rightSel.kind === 'err') {
      return packageSideErrors(leftSel, rightSel);
    }

    const tabular = detectTabularDispatchSafe(req.leftQuery, req.rightQuery);
    if (tabular.kind === 'mixed') {
      return { kind: 'error', errors: { top: tabular.message } };
    }

    if (tabular.kind === 'tabular') {
      return runTabular({
        leftTarget: leftSel.value,
        rightTarget: rightSel.value,
        leftQuery: req.leftQuery as string,
        rightQuery: req.rightQuery as string,
        leftShape: tabular.left,
        rightShape: tabular.right,
        registry: this.registry,
      });
    }

    return runGraph({
      leftTarget: leftSel.value,
      rightTarget: rightSel.value,
      leftQuery: req.leftQuery,
      rightQuery: req.rightQuery,
      skipAuto: req.skipAutoSourceAnnotation === true,
      registry: this.registry,
    });
  }

  private selectFromRegistry(
    ref: string,
    side: 'left' | 'right',
  ): SideSelection {
    const id = ref.startsWith('@') ? ref.slice(1) : ref;
    const found = this.registry.find(
      (src) => src.kind !== 'reference' && src.id === id,
    );
    if (!found) {
      return {
        kind: 'err',
        side,
        message: `unknown @id "${id}" on ${side} side; available: ${availableIds(this.registry)}`,
      };
    }
    return { kind: 'ok', value: found };
  }
}

type SideSelection =
  | { kind: 'ok'; value: ParsedSource }
  | { kind: 'err'; side: 'left' | 'right'; message: string };

function availableIds(registry: ReadonlyArray<ParsedSource>): string {
  const ids = registry
    .filter((s) => s.kind !== 'reference' && s.id !== undefined)
    .map((s) => `@${s.id}`);
  return ids.length === 0 ? '(none)' : ids.join(', ');
}

function packageSideErrors(
  left: SideSelection,
  right: SideSelection,
): DiffErrorResponse {
  const errors: DiffErrorResponse['errors'] = {};
  if (left.kind === 'err') errors.left = left.message;
  if (right.kind === 'err') errors.right = right.message;
  return { kind: 'error', errors };
}

type TabularDispatch =
  | { kind: 'graph' }
  | { kind: 'tabular'; left: SelectShapeReport; right: SelectShapeReport }
  | { kind: 'mixed'; message: string };

function detectTabularDispatchSafe(
  leftQuery: string | undefined,
  rightQuery: string | undefined,
): TabularDispatch {
  if (leftQuery === undefined || rightQuery === undefined) return { kind: 'graph' };
  let left: SelectShapeReport;
  let right: SelectShapeReport;
  try {
    left = detectSelectShape(leftQuery);
    right = detectSelectShape(rightQuery);
  } catch {
    return { kind: 'graph' };
  }
  if (left.shape === 'triples' && right.shape === 'triples') {
    return { kind: 'graph' };
  }
  if (left.shape !== right.shape) {
    const tuplesSide = left.shape === 'tuples' ? 'left' : 'right';
    const triplesSide = tuplesSide === 'left' ? 'right' : 'left';
    return {
      kind: 'mixed',
      message: `mixed-shape diff: ${triplesSide}-side query is triples-shape (CONSTRUCT or SELECT-{?s,?p,?o[,?g]}) while ${tuplesSide}-side query is tuples-shape (arbitrary SELECT). Either project triples on both sides (graph diff) or arbitrary tuples on both sides (tabular diff) — pick one shape and align both queries.`,
    };
  }
  return { kind: 'tabular', left, right };
}

interface RunGraphArgs {
  leftTarget: ParsedSource;
  rightTarget: ParsedSource;
  leftQuery: string | undefined;
  rightQuery: string | undefined;
  skipAuto: boolean;
  registry: ReadonlyArray<ParsedSource>;
}

async function runGraph(args: RunGraphArgs): Promise<DiffResponse> {
  const left = await resolveGraphSide(
    args.leftTarget,
    args.leftQuery,
    args.skipAuto,
    args.registry,
    'left',
  );
  const right = await resolveGraphSide(
    args.rightTarget,
    args.rightQuery,
    args.skipAuto,
    args.registry,
    'right',
  );
  if (left.kind === 'err' || right.kind === 'err') {
    return packageGraphResolveErrors(left, right);
  }

  const result = await diffStores(
    {
      store: left.store,
      annotationPredicates: left.annotationPredicates,
    },
    {
      store: right.store,
      annotationPredicates: right.annotationPredicates,
    },
  );

  return {
    kind: 'graph',
    diff: { added: result.added, removed: result.removed, totals: result.totals },
    sourceRecords: {
      left: mapToRecord(result.sourceRecords.left),
      right: mapToRecord(result.sourceRecords.right),
    },
    totals: result.totals,
  };
}

type GraphSideResolved =
  | {
      kind: 'ok';
      store: Store;
      annotationPredicates: ReturnType<typeof extractAnnotationPredicates>;
    }
  | { kind: 'err'; side: 'left' | 'right'; message: string };

async function resolveGraphSide(
  rawTarget: ParsedSource,
  inlineQuery: string | undefined,
  skipAuto: boolean,
  registry: ReadonlyArray<ParsedSource>,
  side: 'left' | 'right',
): Promise<GraphSideResolved> {
  try {
    const target = withAutoSourceAnnotation(rawTarget, { skipAuto });
    if (inlineQuery !== undefined) {
      const upstream = anonymousUpstream(target, side);
      const store = await resolveAnonymousView({
        source: upstream,
        query: inlineQuery,
      });
      return {
        kind: 'ok',
        store,
        annotationPredicates: extractAnnotationPredicates(undefined),
      };
    }

    if (target.kind === 'endpoint') {
      throw new Error(
        `SPARQL endpoint ${target.endpoint} cannot be diffed directly on the ${side} side (wrap the endpoint in a \`view\` source kind to scope it, or pass \`${side}Query\` to scope it inline)`,
      );
    }

    const sources = await resolveSource(target, { registry });
    if (sources.mode === 'pass-through') {
      throw new Error(
        `SPARQL endpoint ${sources.endpoint.endpoint} cannot be diffed directly on the ${side} side (wrap it in a \`view\` source kind, or pass \`${side}Query\`)`,
      );
    }
    const transforms = target.kind === 'glob' ? target.transforms : undefined;
    return {
      kind: 'ok',
      store: sources.store,
      annotationPredicates: extractAnnotationPredicates(transforms),
    };
  } catch (err) {
    return {
      kind: 'err',
      side,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function packageGraphResolveErrors(
  left: GraphSideResolved,
  right: GraphSideResolved,
): DiffErrorResponse {
  const errors: DiffErrorResponse['errors'] = {};
  if (left.kind === 'err') errors.left = left.message;
  if (right.kind === 'err') errors.right = right.message;
  return { kind: 'error', errors };
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
    const fmt = (s: ReadonlySet<string>): string =>
      `{${[...s].sort().map((v) => `?${v}`).join(', ')}}`;
    return {
      kind: 'error',
      errors: {
        top: `tabular diff requires matching projected variable-name sets: left=${fmt(
          leftSet,
        )}, right=${fmt(rightSet)}`,
      },
    };
  }

  const leftUpstream = anonymousUpstreamSafe(args.leftTarget, 'left');
  const rightUpstream = anonymousUpstreamSafe(args.rightTarget, 'right');
  if (leftUpstream.kind === 'err' || rightUpstream.kind === 'err') {
    const errors: DiffErrorResponse['errors'] = {};
    if (leftUpstream.kind === 'err') errors.left = leftUpstream.message;
    if (rightUpstream.kind === 'err') errors.right = rightUpstream.message;
    return { kind: 'error', errors };
  }

  const sources: SourceSpecInput[] = [...args.registry] as SourceSpecInput[];
  const [leftBindings, rightBindings] = await resolveTabularSidesSafe(
    leftUpstream.value,
    rightUpstream.value,
    args.leftQuery,
    args.rightQuery,
    sources,
  );
  if (leftBindings.kind === 'err' || rightBindings.kind === 'err') {
    const errors: DiffErrorResponse['errors'] = {};
    if (leftBindings.kind === 'err') errors.left = leftBindings.message;
    if (rightBindings.kind === 'err') errors.right = rightBindings.message;
    return { kind: 'error', errors };
  }

  const tab = tabularDiff(
    leftBindings.value.rows,
    rightBindings.value.rows,
    [...args.rightShape.variables],
  );
  return {
    kind: 'tabular',
    diff: tab,
    totals: tab.totals,
    variables: [...args.rightShape.variables],
  };
}

type AnonymousUpstreamResult =
  | { kind: 'ok'; value: SourceSpecInput }
  | { kind: 'err'; side: 'left' | 'right'; message: string };

function anonymousUpstreamSafe(
  target: ParsedSource,
  side: 'left' | 'right',
): AnonymousUpstreamResult {
  try {
    return { kind: 'ok', value: anonymousUpstream(target, side) };
  } catch (err) {
    return {
      kind: 'err',
      side,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function anonymousUpstream(
  target: ParsedSource,
  side: 'left' | 'right',
): SourceSpecInput {
  if (target.kind === 'glob') return target.glob;
  if (target.kind === 'endpoint') return target.endpoint;
  throw new Error(
    `inline scoping query targets a glob or endpoint upstream; ${side} target is a ${target.kind} source`,
  );
}

type TabularSideResult =
  | { kind: 'ok'; value: { rows: TabularRow[] } }
  | { kind: 'err'; side: 'left' | 'right'; message: string };

async function resolveTabularSidesSafe(
  leftUpstream: SourceSpecInput,
  rightUpstream: SourceSpecInput,
  leftQuery: string,
  rightQuery: string,
  registry: ReadonlyArray<SourceSpecInput>,
): Promise<[TabularSideResult, TabularSideResult]> {
  const [left, right] = await Promise.all([
    resolveTabularSafe(leftUpstream, leftQuery, registry, 'left'),
    resolveTabularSafe(rightUpstream, rightQuery, registry, 'right'),
  ]);
  return [left, right];
}

async function resolveTabularSafe(
  upstream: SourceSpecInput,
  query: string,
  registry: ReadonlyArray<SourceSpecInput>,
  side: 'left' | 'right',
): Promise<TabularSideResult> {
  try {
    const result = await resolveAnonymousSelectBindings({
      source: upstream,
      query,
      registry: [...registry],
    });
    return { kind: 'ok', value: result };
  } catch (err) {
    return {
      kind: 'err',
      side,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function mapToRecord(
  m: Map<string, SourceRecord[]>,
): Record<string, SourceRecord[]> {
  const out: Record<string, SourceRecord[]> = {};
  for (const [k, v] of m) out[k] = v;
  return out;
}
