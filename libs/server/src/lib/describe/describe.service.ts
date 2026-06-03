import { Injectable } from '@nestjs/common';
import { describeProvenance, serializeDescribeWire, type PathStep } from 'common';
import {
  describeEndpointResult,
  describeStore,
  relabelBnodes,
  resolveSourceResult,
  selectTargetResult,
  type DescribeEndpointResult,
  type DescribeError,
  type DescribeTopLevelError,
  type EndpointDescribeError,
  type ParsedSource,
  type QuerySources,
  type SourceError,
  type TargetError,
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
  /**
   * Source id (optional leading `@`). Omit to resolve the registry's default
   * source (ADR-0052): a `default: true` marker, else the sole served entry,
   * else a `no-default-multi` error.
   */
  source?: string;
  withProvenance?: boolean;
  perSourceLimit?: number;
  fromSourcePredicate?: string;
  /** Only valid when `source` names an endpoint. Over-long paths are clamped. */
  expandedPaths?: PathStep[][];
}

/** Over-long paths are clamped, not rejected. */
export const MAX_EXPANSION_PATH_STEPS = 12;

export interface DescribeResult {
  iri: string;
  quads: string;
  total: number;
  /**
   * The single source's description was capped, a probe degraded, or dangling
   * blank nodes remain (ADR-0052 flattens the former per-source flag to the
   * top level — describe targets exactly one source).
   */
  truncated: boolean;
}

@Injectable()
export class DescribeService {
  private readonly config: DescribeConfig;

  constructor(
    private readonly servedRegistry: ReadonlyArray<ParsedSource>,
    config: DescribeConfig = DEFAULT_DESCRIBE_CONFIG,
  ) {
    this.config = config;
  }

  runDescribe(
    req: DescribeRequest,
  ): ResultAsync<DescribeResult, DescribeTopLevelError> {
    const seedResult = parseSeed(req.iri);
    if (seedResult.isErr()) return errAsync(seedResult.error);
    const seed = seedResult.value;

    // `expandedPaths` requires an explicit `source` (the paths apply to one
    // endpoint per request). Checked before selection so it isn't shadowed by
    // the no-default-multi resolution error on a multi-source registry.
    const expandedPaths = req.expandedPaths;
    const hasPaths = expandedPaths !== undefined && expandedPaths.length > 0;
    if (hasPaths && req.source === undefined) {
      return errAsync({ kind: 'expanded-paths-without-source' });
    }

    const selection = this.selectSources(req.source);
    if (selection.isErr()) return errAsync(selection.error);
    const selected = selection.value;

    // `req.source` is defined here — the omitted case returned above. The
    // explicit narrowing also lets `id` resolve to a `string`.
    if (hasPaths && req.source !== undefined) {
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

    // Describe targets exactly one source (ADR-0052): the source's own
    // failure *is* the request failure, surfaced as a typed top-level error
    // (ADR-0024) rather than folded into per-source data on an HTTP-200 body.
    const target = selected[0];
    const id = target.id ?? 'source';
    const requestedPaths =
      target.kind === 'endpoint' && req.source !== undefined
        ? req.expandedPaths ?? []
        : [];

    return this.describeOneResult(target, id, seed, perSourceLimit, requestedPaths)
      .mapErr((error): DescribeTopLevelError => error)
      .map((raw) =>
        this.assembleResult(
          req.iri,
          { id, quads: relabelBnodes(raw.quads, id), truncated: raw.truncated },
          withProvenance,
          predicate,
        ),
      );
  }

  private assembleResult(
    iri: string,
    run: SourceRun,
    withProvenance: boolean,
    predicate: string,
  ): DescribeResult {
    // Lexical (s, p, o, g) dedup of the single source's quads. `originsByQuad`
    // collapses to one origin per quad here; it (and the provenance pass) are
    // retained until #409 deletes the merge machinery wholesale.
    const merged = new Map<string, Quad>();
    const originsByQuad = new Map<string, string[]>();
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

    const total = merged.size;
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
    return { iri, quads, total, truncated: run.truncated };
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
    return resolveSourceResult(target)
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
    // Omitted `source` resolves to the registry's default source (ADR-0052),
    // reusing the ADR-0016 default-routing behind `/api/sparql`: a `default: true`
    // marker, else the sole served entry, else a no-default-multi error.
    return selectTargetResult(this.servedRegistry).match(
      (target) => ok([target]),
      (error) => err(mapTargetError(error)),
    );
  }
}

interface SourceRun {
  id: string;
  quads: Quad[];
  truncated: boolean;
}

/**
 * Map the reused ADR-0016 `TargetError` (default-routing) onto describe's own
 * top-level error vocabulary. Only the omitted-`source` branch calls this, so
 * `unknown-ref` (an explicit-ref-only failure) cannot arise; it collapses to
 * `empty-target` for exhaustiveness.
 */
function mapTargetError(error: TargetError): DescribeTopLevelError {
  switch (error.kind) {
    case 'no-default-multi':
      return { kind: 'no-default-multi', availableIds: error.availableIds };
    case 'ref-as-target':
      return { kind: 'reference-target' };
    case 'empty-registry':
    case 'unknown-ref':
      return { kind: 'empty-target' };
  }
}

function isSupportedKind(src: ParsedSource): boolean {
  // `empty`/`reference` are surfaced so callers see an explanatory per-source error.
  return (
    src.kind === 'glob' ||
    src.kind === 'file' ||
    src.kind === 'endpoint' ||
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

function quadKey(q: Quad): string {
  return `${termKey(q.subject)} ${termKey(q.predicate)} ${termKey(q.object)} ${termKey(q.graph)}`;
}

function termKey(t: Term): string {
  if ((t.termType as string) === 'Quad') {
    return `<<${quadKey(t as unknown as Quad)}>>`;
  }
  return `${t.termType}:${t.value}`;
}
