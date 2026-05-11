import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffStores } from './diff';
import { groupRdfDiffByEntity, type HunkedRdfDiff } from './group-rdf-diff-by-entity';
import { loadRdf } from './engine';

const UPDATE = process.env['UPDATE_GOLDENS'] === '1';
const FIXTURES = join(__dirname, '__fixtures__', 'group-rdf-diff-by-entity');
const ERA_SHAPES_DIR = resolve(__dirname, '../../../../test/data');

async function readOrWrite(path: string, actual: string): Promise<string> {
  if (UPDATE) {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, actual, 'utf8');
  }
  return readFile(path, 'utf8');
}

function stableJson(value: HunkedRdfDiff): string {
  // Maps inside SourceRecord buckets are already plain arrays in the result;
  // round-tripping through JSON gives a stable, reviewable text golden.
  return `${JSON.stringify(JSON.parse(JSON.stringify(value)), null, 2)}\n`;
}

describe('groupRdfDiffByEntity — era-shapes 3.2.0 vs 3.2.2 golden', () => {
  it('produces a byte-identical HunkedRdfDiff over the real SHACL fixture pair, exercising bnode absorption + sh:path identity end-to-end', async () => {
    const left = await loadRdf({
      sources: join(ERA_SHAPES_DIR, 'era-shapes-3.2.0.ttl'),
    });
    const right = await loadRdf({
      sources: join(ERA_SHAPES_DIR, 'era-shapes-3.2.2.ttl'),
    });
    const diff = await diffStores(
      { store: left.store },
      { store: right.store },
    );
    const hunked = groupRdfDiffByEntity({
      diff,
      left: { store: left.store },
      right: { store: right.store },
    });
    const golden = await readOrWrite(
      join(FIXTURES, 'era-shapes-3.2.0-vs-3.2.2.json'),
      stableJson(hunked),
    );
    expect(stableJson(hunked)).toBe(golden);
  }, 30_000);
});
