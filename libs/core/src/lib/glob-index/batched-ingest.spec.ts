import { DataFactory, type Quad } from 'n3';
import { describe, expect, it } from 'vitest';
import { ingestQuadStream } from './batched-ingest';

function quad(n: number): Quad {
  return DataFactory.quad(
    DataFactory.namedNode(`urn:s${n}`),
    DataFactory.namedNode('urn:p'),
    DataFactory.namedNode(`urn:o${n}`),
  );
}

async function* quadStream(count: number): AsyncGenerator<Quad> {
  for (let i = 0; i < count; i++) yield quad(i);
}

describe('ingestQuadStream', () => {
  it('issues one multiPut per fixed-size batch with a final partial batch', async () => {
    const batchSizes: number[] = [];
    const store = {
      multiPut: async (quads: Quad[]) => {
        batchSizes.push(quads.length);
      },
    };

    await ingestQuadStream(store, quadStream(7), 3);

    // 7 quads at batchSize 3: two full batches, one partial — no batch ever
    // exceeds the ceiling, so heap never holds more than `batchSize` quads.
    expect(batchSizes).toEqual([3, 3, 1]);
  });

  it('makes no multiPut call for an empty stream', async () => {
    let calls = 0;
    const store = {
      multiPut: async () => {
        calls++;
      },
    };

    await ingestQuadStream(store, quadStream(0), 3);

    expect(calls).toBe(0);
  });

  it('ingests every quad exactly once, in order, across batch boundaries', async () => {
    const seen: Quad[] = [];
    const store = {
      multiPut: async (quads: Quad[]) => {
        seen.push(...quads);
      },
    };

    await ingestQuadStream(store, quadStream(7), 3);

    expect(seen.map((q) => q.subject.value)).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((n) => `urn:s${n}`),
    );
  });

  it('reports each written batch size through the onBatch callback', async () => {
    const store = {
      multiPut: async () => undefined,
    };
    const written: number[] = [];

    await ingestQuadStream(store, quadStream(7), 3, (count) =>
      written.push(count),
    );

    // One callback per `multiPut` — including the trailing partial batch — so a
    // caller can advance a progress counter as quads land on disk (#349).
    expect(written).toEqual([3, 3, 1]);
  });
});
