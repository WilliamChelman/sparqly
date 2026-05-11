import { Injectable } from '@nestjs/common';
import { describeProvenance, serializeDescribeWire } from 'common';
import {
  describeStore,
  relabelBnodes,
  resolveSource,
  type ParsedSource,
} from 'core';
import { DataFactory, type Quad, type Term } from 'n3';

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
}

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

  constructor(
    private readonly registry: ReadonlyArray<ParsedSource>,
    config: DescribeConfig = DEFAULT_DESCRIBE_CONFIG,
  ) {
    this.config = config;
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
        const resolved = await resolveSource(target, {
          registry: this.registry,
        });
        if (resolved.mode !== 'materialized') {
          // Only glob sources are dispatched in this slice; resolveSource of a
          // declared glob will always be materialized. Anything else is a guard.
          runs.push({ id, quads: [], truncated: false });
          continue;
        }
        const raw = describeStore({
          store: resolved.store,
          seed,
          perSourceLimit,
        });
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

  private selectSources(
    requested: ReadonlyArray<string> | undefined,
  ): ParsedSource[] {
    if (requested !== undefined && requested.length === 0) return [];
    const requestedSet = requested
      ? new Set(requested.map((s) => (s.startsWith('@') ? s.slice(1) : s)))
      : undefined;
    const out: ParsedSource[] = [];
    for (const src of this.registry) {
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
  // This slice only dispatches glob sources; endpoint/view come in later
  // slices. empty/reference are intentionally excluded by ADR-0015.
  return src.kind === 'glob';
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

