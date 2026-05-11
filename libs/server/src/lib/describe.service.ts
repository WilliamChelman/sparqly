import { Injectable } from '@nestjs/common';
import {
  describeStore,
  resolveSource,
  type ParsedSource,
} from 'core';
import { DataFactory, Writer, type Quad } from 'n3';

export interface DescribeRequest {
  iri: string;
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
    const target = this.firstGlob();
    if (!target) {
      throw new Error(
        'describe: tracer-bullet slice requires at least one glob source in the registry',
      );
    }
    const sources = await resolveSource(target, { registry: this.registry });
    if (sources.mode !== 'materialized') {
      throw new Error(
        `describe: tracer-bullet slice only supports materialized glob sources; got ${sources.mode}`,
      );
    }
    const seed = DataFactory.namedNode(req.iri);
    const result = describeStore({
      store: sources.store,
      seed,
      perSourceLimit: Number.POSITIVE_INFINITY,
    });
    const serialized = await serializeNQuads(result.quads);
    const id = target.id ?? 'source';
    return {
      iri: req.iri,
      quads: serialized,
      total: result.quads.length,
      perSource: {
        [id]: { count: result.quads.length, truncated: result.truncated },
      },
    };
  }

  private firstGlob(): ParsedSource | undefined {
    return this.registry.find((s) => s.kind === 'glob');
  }
}

async function serializeNQuads(quads: ReadonlyArray<Quad>): Promise<string> {
  if (quads.length === 0) return '';
  const writer = new Writer({ format: 'application/n-quads' });
  for (const q of quads) writer.addQuad(q);
  return new Promise<string>((resolve, reject) => {
    writer.end((err: Error | null | undefined, result: string) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}
