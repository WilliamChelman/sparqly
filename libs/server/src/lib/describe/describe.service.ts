import { Injectable } from '@nestjs/common';
import { describeProvenance, serializeDescribeWire, type PathStep } from 'common';
import {
  describeEndpoint,
  describeStore,
  relabelBnodes,
  resolveSource,
  type ParsedSource,
} from 'core';
import { DataFactory, type NamedNode, type Quad, type Term } from 'n3';

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
   * {@link describeEndpoint}; `glob`/`view` sources ignore it (already fully
   * expanded). Paths longer than {@link MAX_EXPANSION_PATH_STEPS} are clamped
   * and the affected source is reported `truncated`.
   */
  expandedPaths?: Record<string, PathStep[][]>;
}

/** Cap on expansion-path length (ADR-0019); over-long paths are clamped, not rejected. */
export const MAX_EXPANSION_PATH_STEPS = 12;

export interface DescribePerSourceEntry {
  count: number;
  truncated: boolean;
  /** Present when this source's describe run failed; the source contributed
   * no quads but the request still succeeds if any other source did. */
  error?: string;
}

export interface DescribeResponse {
  iri: string;
  quads: string;
  total: number;
  perSource: Record<string, DescribePerSourceEntry>;
}

export interface DescribeResult {
  /** `'all-sources-failed'` when every selected source threw — the controller
   * maps that to HTTP 502. `'ok'` otherwise (including zero sources selected
   * and partial failures). The per-source error map is on `response` either way. */
  status: 'ok' | 'all-sources-failed';
  response: DescribeResponse;
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

  async runDescribe(req: DescribeRequest): Promise<DescribeResult> {
    const predicate =
      req.fromSourcePredicate ?? this.config.fromSourcePredicate;
    const withProvenance = req.withProvenance !== false;
    const requestedLimit = req.perSourceLimit ?? this.config.perSourceSoftLimit;
    // Defense in depth: a client cannot blow past the deployment ceiling.
    const perSourceLimit = Math.min(
      requestedLimit,
      this.config.perSourceHardLimit,
    );

    const selected = this.selectSources(req.sources);
    const seed = DataFactory.namedNode(req.iri);

    type SourceRun = {
      id: string;
      quads: Quad[];
      truncated: boolean;
      error?: string;
    };
    const runs: SourceRun[] = [];
    for (const target of selected) {
      const id = target.id ?? 'source';
      try {
        const raw = await this.describeOne(
          target,
          id,
          seed,
          perSourceLimit,
          req.expandedPaths?.[id] ?? [],
        );
        const relabelled = relabelBnodes(raw.quads, id);
        runs.push({ id, quads: relabelled, truncated: raw.truncated });
      } catch (err) {
        runs.push({
          id,
          quads: [],
          truncated: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

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
          annotations.push(...describeProvenance.inject([q], origin, predicate).slice(1));
        }
      }
      wire = [...wire, ...annotations];
    }

    const quads = serializeDescribeWire(wire);
    const response: DescribeResponse = {
      iri: req.iri,
      quads,
      total,
      perSource,
    };

    // 502 only when sources were configured-and-attempted and every one failed.
    // Zero sources selected is not a failure (honest empty result).
    const attempted = runs.length;
    const failed = runs.filter((r) => r.error !== undefined).length;
    const status: DescribeResult['status'] =
      attempted > 0 && failed === attempted ? 'all-sources-failed' : 'ok';

    return { status, response };
  }

  /**
   * Per-source dispatch (ADR-0015, issues #189/#190). `glob` and `view` resolve
   * via {@link resolveSource} to an in-memory materialized store — a view's
   * upstream (glob, endpoint, or another view) is snapshotted first — then run
   * {@link describeStore} against that stable store. `endpoint` runs
   * {@link describeEndpoint} over the wire. `empty` and `reference` sources have
   * no describable graph of their own — they reject with guidance, which
   * `runDescribe` surfaces as a per-source error rather than a global failure.
   */
  private async describeOne(
    target: ParsedSource,
    id: string,
    seed: NamedNode,
    perSourceLimit: number,
    requestedPaths: ReadonlyArray<PathStep[]>,
  ): Promise<{ quads: Quad[]; truncated: boolean }> {
    if (target.kind === 'endpoint') {
      const paths = requestedPaths.map((p) =>
        p.slice(0, MAX_EXPANSION_PATH_STEPS),
      );
      const clamped = requestedPaths.some(
        (p) => p.length > MAX_EXPANSION_PATH_STEPS,
      );
      const raw = await describeEndpoint({
        endpoint: target,
        seed,
        perSourceLimit,
        paths,
      });
      return { quads: raw.quads, truncated: raw.truncated || clamped };
    }
    if (target.kind === 'empty') {
      throw new Error(
        `source '${id}' is an empty source with no data of its own; ` +
          'to describe over it, describe a view that scopes this empty ' +
          "source's `SERVICE` composition",
      );
    }
    if (target.kind === 'reference') {
      throw new Error(
        `source '${id}' is a \`reference\` alias to '${target.ref}'; ` +
          'describe that source directly',
      );
    }
    // `glob` and `view` both land here; `resolveSource` materializes a view's
    // upstream chain into an in-memory store before we describe over it.
    const resolved = await resolveSource(target, {
      registry: this.resolutionRegistry,
    });
    if (resolved.mode !== 'materialized') {
      // A declared glob/view always resolves to a materialized store; anything
      // else here is a guard against an unexpected resolver outcome.
      return { quads: [], truncated: false };
    }
    const raw = describeStore({ store: resolved.store, seed, perSourceLimit });
    return { quads: raw.quads, truncated: raw.truncated };
  }

  private selectSources(
    requested: ReadonlyArray<string> | undefined,
  ): ParsedSource[] {
    if (requested !== undefined && requested.length === 0) return [];
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
    return out;
  }
}

function isSupportedKind(src: ParsedSource): boolean {
  // `glob`, `endpoint` and `view` produce a describable graph; `empty` and
  // `reference` are surfaced so the caller gets an explanatory per-source error
  // rather than a silent omission.
  return (
    src.kind === 'glob' ||
    src.kind === 'endpoint' ||
    src.kind === 'view' ||
    src.kind === 'empty' ||
    src.kind === 'reference'
  );
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

