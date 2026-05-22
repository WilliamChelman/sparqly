import type { Quad } from 'n3';

/**
 * Quads per `multiPut` batch (#347). An internal constant, not a user knob:
 * it bounds the build's heap so a multi-GB file stays buildable at flat
 * memory, regardless of file size.
 */
export const INGEST_BATCH_SIZE = 10_000;

/** The slice of a quadstore the streamed ingest needs — a batched writer. */
interface BatchPutStore {
  multiPut(quads: Quad[]): Promise<unknown>;
}

/**
 * Streams `quads` into `store` in fixed-size batches: every full batch of
 * `batchSize` quads is written with one `multiPut`, and the trailing partial
 * batch is flushed at the end. The caller never materializes the whole quad
 * stream — at most `batchSize` quads sit in heap at once (#347).
 */
export async function ingestQuadStream(
  store: BatchPutStore,
  quads: AsyncIterable<Quad>,
  batchSize: number = INGEST_BATCH_SIZE,
): Promise<void> {
  let batch: Quad[] = [];
  for await (const quad of quads) {
    batch.push(quad);
    if (batch.length >= batchSize) {
      await store.multiPut(batch);
      batch = [];
    }
  }
  if (batch.length > 0) await store.multiPut(batch);
}
