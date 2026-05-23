import type { Quad } from 'n3';

/** Bounds the build's heap so multi-GB files stay buildable at flat memory. */
export const INGEST_BATCH_SIZE = 10_000;

interface BatchPutStore {
  multiPut(quads: Quad[]): Promise<unknown>;
}

export async function ingestQuadStream(
  store: BatchPutStore,
  quads: AsyncIterable<Quad>,
  batchSize: number = INGEST_BATCH_SIZE,
  onBatch?: (count: number) => void,
): Promise<number> {
  let batch: Quad[] = [];
  let total = 0;
  for await (const quad of quads) {
    batch.push(quad);
    if (batch.length >= batchSize) {
      await store.multiPut(batch);
      total += batch.length;
      onBatch?.(batch.length);
      batch = [];
    }
  }
  if (batch.length > 0) {
    await store.multiPut(batch);
    total += batch.length;
    onBatch?.(batch.length);
  }
  return total;
}
