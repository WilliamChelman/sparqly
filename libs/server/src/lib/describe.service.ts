import { Injectable } from '@nestjs/common';
import { describeProvenance, serializeDescribeWire } from 'common';
import {
  describeStore,
  relabelBnodes,
  resolveSource,
  type ParsedSource,
} from 'core';
import { DataFactory, type Quad, type Term } from 'n3';

const DEFAULT_FROM_SOURCE_PREDICATE = 'urn:sparqly:fromSource';

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
}

export interface DescribeResponse {
  iri: string;
  quads: string;
  total: number;
  perSource: Record<string, DescribePerSourceEntry>;
}

@Injectable()
export class DescribeService {
  constructor(private readonly registry: ReadonlyArray<ParsedSource>) {}

  async runDescribe(req: DescribeRequest): Promise<DescribeResponse> {
    const predicate = req.fromSourcePredicate ?? DEFAULT_FROM_SOURCE_PREDICATE;
    const withProvenance = req.withProvenance !== false;
    const perSourceLimit = req.perSourceLimit ?? Number.POSITIVE_INFINITY;

    const selected = this.selectSources(req.sources);
    const seed = DataFactory.namedNode(req.iri);

    type SourceRun = {
      id: string;
      quads: Quad[];
      truncated: boolean;
    };
    const runs: SourceRun[] = [];
    for (const target of selected) {
      const id = target.id ?? 'source';
      const resolved = await resolveSource(target, { registry: this.registry });
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
    return {
      iri: req.iri,
      quads,
      total,
      perSource,
    };
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

