import { Injectable } from '@nestjs/common';
import { describeProvenance, serializeDescribeWire, type PathStep } from 'common';
import {
  describeEndpointResult,
  describeStore,
  relabelBnodes,
  resolveSourceResult,
  type DescribeEndpointResult,
  type DescribeError,
  type DescribeTopLevelError,
  type EndpointDescribeError,
  type ParsedSource,
  type QuerySources,
  type SourceError,
} from 'core';
import { DataFactory, type NamedNode, type Quad, type Term } from 'n3';
import {
  ResultAsync,
  errAsync,
  okAsync,
  type Result,
  err,
  ok,
} from 'neverthrow';

export const DEFAULT_DESCRIBE_CONFIG: DescribeConfig = {
  perSourceSoftLimit: 10000,
  perSourceHardLimit: 100000,
  fromSourcePredicate: 'urn:sparqly:fromSource',
};

export interface DescribeConfig {
  perSourceSoftLimit: number;
  perSourceHardLimit: number;
  fromSourcePredicate: string;
}

export interface DescribeRequest {
  iri: string;
  /** Source id (optional leading `@`) or omit to fan out across the served registry. */
  source?: string;
  withProvenance?: boolean;
  perSourceLimit?: number;
  fromSourcePredicate?: string;
  /** Only valid when `source` names an endpoint. Over-long paths are clamped. */
  expandedPaths?: PathStep[][];
}

/** Over-long paths are clamped, not rejected. */
export const MAX_EXPANSION_PATH_STEPS = 12;

export interface DescribePerSourceEntry {
  count: number;
  truncated: boolean;
  error?: DescribeError;
}

export interface DescribeResult {
  iri: string;
  quads: string;
  total: number;
  perSource: Record<string, DescribePerSourceEntry>;
}

@Injectable()
export class DescribeService {
  private readonly config: DescribeConfig;
  private readonly resolutionRegistry: ReadonlyArray<ParsedSource>;

  constructor(
    private readonly servedRegistry: ReadonlyArray<ParsedSource>,
    config: DescribeConfig = DEFAULT_DESCRIBE_CONFIG,
    resolutionRegistry: ReadonlyArray<ParsedSource> = servedRegistry,
  ) {
    this.config = config;
    this.resolutionRegistry = resolutionRegistry;
  }

  runDescribe(
    req: DescribeRequest,
  ): ResultAsync<DescribeResult, DescribeTopLevelError> {
    const seedResult = parseSeed(req.iri);
    if (seedResult.isErr()) return errAsync(seedResult.error);
    const seed = seedResult.value;

    const selection = this.selectSources(req.source);
    if (selection.isErr()) return errAsync(selection.error);
    const selected = selection.value;

    const expandedPaths = req.expandedPaths;
    if (expandedPaths !== undefined && expandedPaths.length > 0) {
      if (req.source === undefined) {
        return errAsync({ kind: 'expanded-paths-without-source' });
      }
      const target = selected[0];
      if (target.kind !== 'endpoint') {
        return errAsync({
          kind: 'expanded-paths-non-endpoint-source',
          id: target.id ?? req.source,
          sourceKind: target.kind,
        });
      }
    }

    const predicate =
      req.fromSourcePredicate ?? this.config.fromSourcePredicate;
    const withProvenance = req.withProvenance !== false;
    const requestedLimit = req.perSourceLimit ?? this.config.perSourceSoftLimit;
    // Defense in depth: a client cannot blow past the deployment ceiling.
    const perSourceLimit = Math.min(
      requestedLimit,
      this.config.perSourceHardLimit,
    );

    // Combining never short-circuits — a single failing source does not fail
    // the request; the all-failed case is checked after all sources resolve.
    const folded = selected.map((target) => {
      const id = target.id ?? 'source';
      const requestedPaths =
        target.kind === 'endpoint' && req.source !== undefined
          ? req.expandedPaths ?? []
          : [];
      return this.describeOneResult(target, id, seed, perSourceLimit, requestedPaths)
        .map(
          (raw): SourceRun => ({
            id,
            quads: relabelBnodes(raw.quads, id),
            truncated: raw.truncated,
          }),
        )
        .orElse(
          (error): ResultAsync<SourceRun, never> =>
            okAsync({ id, quads: [], truncated: false, error }),
        );
    });

    return ResultAsync.combine(folded).andThen((runs) =>
      this.assembleResult(req.iri, runs, withProvenance, predicate),
    );
  }

  private assembleResult(
    iri: string,
    runs: ReadonlyArray<SourceRun>,
    withProvenance: boolean,
    predicate: string,
  ): ResultAsync<DescribeResult, DescribeTopLevelError> {
    // Merge with lexical (s, p, o, g) dedup. Track per-source membership so
    // we can both report perSource.count and inject one annotation per
    // (quad, origin) pair on the wire.
    const merged = new Map<string, Quad>();
    const originsByQuad = new Map<string, string[]>();
    for (const run of runs) {
      for (const q of run.quads) {
        const key = quadKey(q);
        if (!merged.has(key)) merged.set(key, q);
        const list = originsByQuad.get(key);
        if (list) {
          if (!list.includes(run.id)) list.push(run.id);
        } else {
          originsByQuad.set(key, [run.id]);
        }
      }
    }

    const total = merged.size;
    const perSource: Record<string, DescribePerSourceEntry> = {};
    for (const run of runs) {
      if (run.error !== undefined) {
        perSource[run.id] = { count: 0, truncated: false, error: run.error };
        continue;
      }
      const count = countMembership(originsByQuad, run.id);
      perSource[run.id] = { count, truncated: run.truncated };
    }

    let wire: Quad[] = [...merged.values()];
    if (withProvenance) {
      const annotations: Quad[] = [];
      for (const [key, q] of merged) {
        const origins = originsByQuad.get(key) ?? [];
        for (const origin of origins) {
          annotations.push(
            ...describeProvenance.inject([q], origin, predicate).slice(1),
          );
        }
      }
      wire = [...wire, ...annotations];
    }

    const quads = serializeDescribeWire(wire);
    const result: DescribeResult = { iri, quads, total, perSource };

    const attempted = runs.length;
    const failed = runs.filter((r) => r.error !== undefined).length;
    if (attempted > 0 && failed === attempted) {
      const failures: Record<string, DescribeError> = {};
      for (const run of runs) {
        if (run.error !== undefined) failures[run.id] = run.error;
      }
      return errAsync({ kind: 'all-sources-failed', perSource: failures });
    }
    return okAsync(result);
  }

  private describeOneResult(
    target: ParsedSource,
    id: string,
    seed: NamedNode,
    perSourceLimit: number,
    requestedPaths: ReadonlyArray<PathStep[]>,
  ): ResultAsync<{ quads: Quad[]; truncated: boolean }, DescribeError> {
    if (target.kind === 'endpoint') {
      const paths = requestedPaths.map((p) =>
        p.slice(0, MAX_EXPANSION_PATH_STEPS),
      );
      const clamped = requestedPaths.some(
        (p) => p.length > MAX_EXPANSION_PATH_STEPS,
      );
      return describeEndpointResult({
        endpoint: target,
        seed,
        perSourceLimit,
        paths,
      })
        .map((raw: DescribeEndpointResult) => ({
          quads: raw.quads,
          truncated: raw.truncated || clamped,
        }))
        .mapErr(
          (e: EndpointDescribeError): DescribeError => ({
            kind: 'endpoint-describe',
            endpoint: e.endpoint,
            message: e.message,
          }),
        );
    }
    if (target.kind === 'empty') {
      return errAsync({ kind: 'empty-source', id });
    }
    if (target.kind === 'reference') {
      return errAsync({ kind: 'reference-source', id, ref: target.ref });
    }
    return resolveSourceResult(target, {
      registry: this.resolutionRegistry,
    })
      .mapErr((source: SourceError): DescribeError => ({ kind: 'source', source }))
      .andThen<{ quads: Quad[]; truncated: boolean }, DescribeError>(
        (resolved: QuerySources) => {
          if (resolved.mode === 'disk-backed') {
            // Release the LevelDB lock; describe needs a synchronous in-heap Store.
            void resolved.close();
            return errAsync({ kind: 'disk-backed-source', id });
          }
          if (resolved.mode !== 'materialized') {
            return okAsync({ quads: [] as Quad[], truncated: false });
          }
          const raw = describeStore({
            store: resolved.store,
            seed,
            perSourceLimit,
          });
          return okAsync({ quads: raw.quads, truncated: raw.truncated });
        },
      );
  }

  private selectSources(
    requested: string | undefined,
  ): Result<ParsedSource[], DescribeTopLevelError> {
    if (requested !== undefined) {
      const id = requested.startsWith('@') ? requested.slice(1) : requested;
      const match = this.servedRegistry.find(
        (s) => isSupportedKind(s) && s.id === id,
      );
      if (!match) return err({ kind: 'empty-target' });
      if (match.kind === 'reference') return err({ kind: 'reference-target' });
      return ok([match]);
    }
    const servedIds = new Set<string>();
    for (const src of this.servedRegistry) {
      if (src.id !== undefined) servedIds.add(src.id);
    }
    const out: ParsedSource[] = [];
    for (const src of this.servedRegistry) {
      if (!isSupportedKind(src)) continue;
      if (src.id === undefined) continue;
      if (src.kind === 'empty') continue;
      if (src.kind === 'reference') continue;
      if (src.kind === 'file' && servedIds.has(src.parentId)) continue;
      out.push(src);
    }
    if (out.length === 0) return err({ kind: 'empty-target' });
    return ok(out);
  }
}

interface SourceRun {
  id: string;
  quads: Quad[];
  truncated: boolean;
  error?: DescribeError;
}

function isSupportedKind(src: ParsedSource): boolean {
  // `empty`/`reference` are surfaced so callers see an explanatory per-source error.
  return (
    src.kind === 'glob' ||
    src.kind === 'file' ||
    src.kind === 'endpoint' ||
    src.kind === 'view' ||
    src.kind === 'empty' ||
    src.kind === 'reference'
  );
}

/** Cheap shape check — catches obvious junk at the boundary so it 400s instead of 502s. */
function parseSeed(value: string): Result<NamedNode, DescribeTopLevelError> {
  if (typeof value !== 'string' || value.length === 0) {
    return err({ kind: 'seed-not-iri', value: String(value) });
  }
  if (!/^[A-Za-z][A-Za-z0-9+\-.]*:/.test(value)) {
    return err({ kind: 'seed-not-iri', value });
  }
  return ok(DataFactory.namedNode(value));
}

function countMembership(
  originsByQuad: Map<string, string[]>,
  id: string,
): number {
  let n = 0;
  for (const origins of originsByQuad.values()) {
    if (origins.includes(id)) n++;
  }
  return n;
}

function quadKey(q: Quad): string {
  return `${termKey(q.subject)} ${termKey(q.predicate)} ${termKey(q.object)} ${termKey(q.graph)}`;
}

function termKey(t: Term): string {
  if ((t.termType as string) === 'Quad') {
    return `<<${quadKey(t as unknown as Quad)}>>`;
  }
  return `${t.termType}:${t.value}`;
}
