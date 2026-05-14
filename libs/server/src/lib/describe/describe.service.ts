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
  /** Per-source quad cap applied when a request omits `perSourceLimit`. */
  perSourceSoftLimit: number;
  /** Absolute ceiling — a request-supplied `perSourceLimit` cannot exceed it. */
  perSourceHardLimit: number;
  /** Default RDF-star annotation predicate for describe provenance. */
  fromSourcePredicate: string;
}

export interface DescribeRequest {
  iri: string;
  sources?: ReadonlyArray<string>;
  withProvenance?: boolean;
  perSourceLimit?: number;
  fromSourcePredicate?: string;
  /**
   * UI-driven blank-node expansion paths per source id (ADR-0019). For each
   * `endpoint` source, `expandedPaths[id]` is forwarded as `paths` to
   * {@link describeEndpointResult}; `glob`/`view` sources ignore it (already
   * fully expanded). Paths longer than {@link MAX_EXPANSION_PATH_STEPS} are
   * clamped and the affected source is reported `truncated`.
   */
  expandedPaths?: Record<string, PathStep[][]>;
}

/** Cap on expansion-path length (ADR-0019); over-long paths are clamped, not rejected. */
export const MAX_EXPANSION_PATH_STEPS = 12;

export interface DescribePerSourceEntry {
  count: number;
  truncated: boolean;
  /**
   * Present when this source's describe run failed; the source contributed
   * no quads but the request still succeeds if any other source did. Carries
   * a structured `DescribeError` (ADR-0024 + ADR-0025).
   */
  error?: DescribeError;
}

/**
 * The describe service's ok payload (ADR-0025). The top-level `Result` errs
 * only on precondition violations or when every selected source failed;
 * per-source failures travel as data inside `perSource[id].error?`.
 */
export interface DescribeResult {
  iri: string;
  quads: string;
  total: number;
  perSource: Record<string, DescribePerSourceEntry>;
}

@Injectable()
export class DescribeService {
  private readonly config: DescribeConfig;
  /** Registry used to walk `from:` chains while resolving a source's graph. */
  private readonly resolutionRegistry: ReadonlyArray<ParsedSource>;

  constructor(
    /** Sources `serve` exposes — the default enumeration set when a request omits `sources`. */
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

    const selection = this.selectSources(req.sources);
    if (selection.isErr()) return errAsync(selection.error);
    const selected = selection.value;

    const predicate =
      req.fromSourcePredicate ?? this.config.fromSourcePredicate;
    const withProvenance = req.withProvenance !== false;
    const requestedLimit = req.perSourceLimit ?? this.config.perSourceSoftLimit;
    // Defense in depth: a client cannot blow past the deployment ceiling.
    const perSourceLimit = Math.min(
      requestedLimit,
      this.config.perSourceHardLimit,
    );

    // Aggregator (ADR-0025): each per-source resolution is folded into an
    // `Ok<SourceRun>` whose `error` field carries the per-source failure as
    // data. Combining never short-circuits — a single failing source does
    // not fail the request. The all-failed terminal case is checked below
    // after every source has resolved.
    const folded = selected.map((target) => {
      const id = target.id ?? 'source';
      const requestedPaths = req.expandedPaths?.[id] ?? [];
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

    // All-failed terminal case (ADR-0025): only fires when sources were
    // attempted AND every one of them failed. Zero attempted sources is
    // caught earlier as `empty-target`, so `attempted > 0` always holds when
    // we get here.
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

  /**
   * Per-source dispatch (ADR-0015, issues #189/#190). `glob` and `view` resolve
   * via {@link resolveSourceResult} to an in-memory materialized store — a view's
   * upstream (glob, endpoint, or another view) is snapshotted first — then run
   * {@link describeStore} against that stable store. `endpoint` runs
   * {@link describeEndpointResult} over the wire. `empty` and `reference`
   * sources have no describable graph of their own — they resolve to their
   * respective {@link DescribeError} variants and {@link runDescribe} surfaces
   * them as per-source errors rather than global failures.
   */
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
        // Surface as `endpoint-describe` (a DescribeError variant) — the
        // failure is the describe-endpoint flow itself, not a view's
        // upstream fetch (which would arrive via resolveSourceResult and
        // wrap as `SourceWrappedError`).
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
    // `glob` and `view` both land here; `resolveSourceResult` materializes a
    // view's upstream chain into an in-memory store before we describe over it.
    return resolveSourceResult(target, {
      registry: this.resolutionRegistry,
    })
      .mapErr((source: SourceError): DescribeError => ({ kind: 'source', source }))
      .map((resolved: QuerySources) => {
        if (resolved.mode !== 'materialized') {
          // A declared glob/view always resolves to a materialized store;
          // anything else here is a guard against an unexpected resolver
          // outcome.
          return { quads: [] as Quad[], truncated: false };
        }
        const raw = describeStore({ store: resolved.store, seed, perSourceLimit });
        return { quads: raw.quads, truncated: raw.truncated };
      });
  }

  private selectSources(
    requested: ReadonlyArray<string> | undefined,
  ): Result<ParsedSource[], DescribeTopLevelError> {
    if (requested !== undefined && requested.length === 0) {
      return err({ kind: 'empty-target' });
    }
    const requestedSet = requested
      ? new Set(requested.map((s) => (s.startsWith('@') ? s.slice(1) : s)))
      : undefined;
    const out: ParsedSource[] = [];
    for (const src of this.servedRegistry) {
      if (!isSupportedKind(src)) continue;
      const id = src.id;
      if (id === undefined) continue;
      if (requestedSet && !requestedSet.has(id)) continue;
      out.push(src);
    }
    if (out.length === 0) return err({ kind: 'empty-target' });
    if (out.every((s) => s.kind === 'reference')) {
      return err({ kind: 'reference-target' });
    }
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
  // `glob`, `endpoint`, `view`, `empty`, and `reference` are all surfaced so
  // the caller gets an explanatory per-source error (for `empty`/`reference`)
  // rather than a silent omission.
  return (
    src.kind === 'glob' ||
    src.kind === 'endpoint' ||
    src.kind === 'view' ||
    src.kind === 'empty' ||
    src.kind === 'reference'
  );
}

/**
 * Reject anything that doesn't look like an IRI before we hand it to source
 * resolution. Cheap shape check — a non-empty value with a scheme-style
 * `scheme:` prefix (per RFC 3987 §2.2). Full IRI validation is deferred to
 * the underlying engines; this gate just catches obvious junk (empty strings,
 * paths, plain words) at the request boundary so it surfaces as a 400
 * precondition violation rather than a 502 endpoint failure.
 */
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
