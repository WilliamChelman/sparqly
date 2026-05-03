import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalizeRdf, canonicalizeStore } from './canonicalize';
import { parseSourceSpec } from './source-spec';
import { resolveSource } from './resolve-source';
import { extractAnnotationPredicates } from './annotate-transform';

async function hashOf(file: string, transforms?: ReadonlyArray<unknown>) {
  const spec = parseSourceSpec(
    transforms === undefined ? { glob: file } : { glob: file, transforms },
  );
  const resolved = await resolveSource(spec);
  if (resolved.mode !== 'materialized') throw new Error('expected materialized');
  const { canonicalText } = await canonicalizeStore(resolved.store, {
    annotationPredicates: extractAnnotationPredicates(
      spec.kind === 'glob' ? spec.transforms : undefined,
    ),
  });
  return createHash('sha256').update(canonicalText).digest('hex');
}

describe('canonicalizeRdf', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-canonicalize-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trip: a single ttl and its split parts produce the same canonical text', async () => {
    const single = join(dir, 'domain.ttl');
    await writeFile(
      single,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
        ex:e ex:r ex:f .
      ` + '\n',
    );

    const partsDir = join(dir, 'parts');
    await mkdir(partsDir);
    await writeFile(
      join(partsDir, 'one.ttl'),
      '@prefix ex: <http://example.org/> . ex:c ex:q ex:d .\n',
    );
    await writeFile(
      join(partsDir, 'two.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
    );
    await writeFile(
      join(partsDir, 'three.ttl'),
      '@prefix ex: <http://example.org/> . ex:e ex:r ex:f .\n',
    );

    const a = await canonicalizeRdf({ sources: single });
    const b = await canonicalizeRdf({ sources: join(partsDir, '*.ttl') });

    expect(a.canonicalText).toBe(b.canonicalText);
    expect(a.canonicalStatements).toHaveLength(3);
  });

  it('canonical text is invariant under blank-node relabeling, ordering, prefix, and whitespace', async () => {
    const a = join(dir, 'a.ttl');
    await writeFile(
      a,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:s ex:p _:b1 .
        _:b1 ex:q "v" .
        ex:x ex:y ex:z .
      ` + '\n',
    );
    const b = join(dir, 'b.ttl');
    await writeFile(
      b,
      dedent`
        @prefix other: <http://example.org/> .

           other:x   other:y   other:z   .
        _:differentLabel    other:q    "v"   .
        other:s other:p _:differentLabel .
      ` + '\n',
    );

    const resultA = await canonicalizeRdf({ sources: a });
    const resultB = await canonicalizeRdf({ sources: b });

    expect(resultB.canonicalText).toBe(resultA.canonicalText);
  });

  it('produces canonical text for every loader-supported format', async () => {
    const triples =
      '<http://example.org/a> <http://example.org/p> <http://example.org/b> .\n';
    const files = {
      ttl: join(dir, 'data.ttl'),
      nt: join(dir, 'data.nt'),
      nq: join(dir, 'data.nq'),
      trig: join(dir, 'data.trig'),
      jsonld: join(dir, 'data.jsonld'),
      rdf: join(dir, 'data.rdf'),
    };
    await writeFile(files.ttl, triples);
    await writeFile(files.nt, triples);
    await writeFile(files.nq, triples);
    await writeFile(
      files.trig,
      '@prefix ex: <http://example.org/> . { ex:a ex:p ex:b . }\n',
    );
    await writeFile(
      files.jsonld,
      JSON.stringify({
        '@id': 'http://example.org/a',
        'http://example.org/p': { '@id': 'http://example.org/b' },
      }),
    );
    await writeFile(
      files.rdf,
      dedent`
        <?xml version="1.0"?>
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:ex="http://example.org/">
          <rdf:Description rdf:about="http://example.org/a">
            <ex:p rdf:resource="http://example.org/b"/>
          </rdf:Description>
        </rdf:RDF>
      ` + '\n',
    );

    for (const file of Object.values(files)) {
      const result = await canonicalizeRdf({ sources: file });
      expect(result.canonicalStatements.length).toBeGreaterThan(0);
      expect(result.canonicalText.endsWith('\n')).toBe(true);
    }
  });

  it('graphMode=flatten flattens a .trig with named graphs to the same canonical text as the equivalent triples-only .ttl', async () => {
    const trig = join(dir, 'data.trig');
    await writeFile(
      trig,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:g1 { ex:a ex:p ex:b . }
        ex:g2 { ex:c ex:q ex:d . }
      ` + '\n',
    );
    const ttl = join(dir, 'data.ttl');
    await writeFile(
      ttl,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );

    const fromTrig = await canonicalizeRdf({
      sources: trig,
      graphMode: 'flatten',
    });
    const fromTtl = await canonicalizeRdf({ sources: ttl });

    expect(fromTrig.canonicalText).toBe(fromTtl.canonicalText);
  });

  it('annotated glob source produces the same canonical text as the same source without `annotate`', async () => {
    const file = join(dir, 'data.ttl');
    await writeFile(
      file,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );

    const plainSpec = parseSourceSpec({ glob: file });
    const annotatedSpec = parseSourceSpec({
      glob: file,
      transforms: [{ annotate: {} }],
    });

    const plain = await resolveSource(plainSpec);
    const annotated = await resolveSource(annotatedSpec);
    if (plain.mode !== 'materialized' || annotated.mode !== 'materialized') {
      throw new Error('expected materialized');
    }
    // Annotated store contains the source-record extras…
    expect(annotated.store.size).toBeGreaterThan(plain.store.size);
    // …but canonicalization strips them and yields identical canonical text.
    const plainCanon = await canonicalizeStore(plain.store);
    const annotatedCanon = await canonicalizeStore(annotated.store);
    expect(annotatedCanon.canonicalText).toBe(plainCanon.canonicalText);
  });

  it('hash is identical with and without `annotate` listed (uses sha256 over canonical text)', async () => {
    const file = join(dir, 'data.ttl');
    await writeFile(
      file,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );
    const plain = await hashOf(file);
    const annotated = await hashOf(file, [{ annotate: {} }]);
    expect(annotated).toBe(plain);
  });

  it('hash is identical across whitespace, ordering, and line-wrapping reformats of the underlying Turtle (annotate listed)', async () => {
    const baseline = join(dir, 'baseline.ttl');
    await writeFile(
      baseline,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
        ex:e ex:r ex:f .
      ` + '\n',
    );

    // Same triples, different prefix label, reordered, extra whitespace,
    // multi-line predicate-object lists.
    const reformatted = join(dir, 'reformatted.ttl');
    await writeFile(
      reformatted,
      dedent`
        @prefix other: <http://example.org/> .

           other:e   other:r   other:f   .
        other:c
            other:q
            other:d   .
        other:a other:p other:b .
      ` + '\n',
    );

    const baselineHash = await hashOf(baseline, [{ annotate: {} }]);
    const reformattedHash = await hashOf(reformatted, [{ annotate: {} }]);
    expect(reformattedHash).toBe(baselineHash);
  });

  it('hash with custom annotation predicate IRIs equals the unannotated baseline', async () => {
    const file = join(dir, 'data.ttl');
    await writeFile(
      file,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
      ` + '\n',
    );
    const baseline = await hashOf(file);
    const customAnnotated = await hashOf(file, [
      {
        annotate: {
          source: 'http://example.org/src',
          file: 'http://example.org/file',
          line: 'http://example.org/line',
        },
      },
    ]);
    expect(customAnnotated).toBe(baseline);
  });

  it('honours custom annotate predicate IRIs threaded from the source-spec', async () => {
    const file = join(dir, 'data.ttl');
    await writeFile(
      file,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
      ` + '\n',
    );
    const plainSpec = parseSourceSpec({ glob: file });
    const customPredicates = {
      source: 'http://example.org/src',
      file: 'http://example.org/file',
      line: 'http://example.org/line',
    };
    const annotatedSpec = parseSourceSpec({
      glob: file,
      transforms: [{ annotate: customPredicates }],
    });

    const plain = await resolveSource(plainSpec);
    const annotated = await resolveSource(annotatedSpec);
    if (plain.mode !== 'materialized' || annotated.mode !== 'materialized') {
      throw new Error('expected materialized');
    }
    const plainCanon = await canonicalizeStore(plain.store);
    const annotatedCanon = await canonicalizeStore(annotated.store, {
      annotationPredicates: extractAnnotationPredicates(
        annotatedSpec.kind === 'glob' ? annotatedSpec.transforms : undefined,
      ),
    });
    expect(annotatedCanon.canonicalText).toBe(plainCanon.canonicalText);
  });

  it('a glob passed via the array sources form merges into the same canonical text as the equivalent single file', async () => {
    const single = join(dir, 'domain.ttl');
    await writeFile(
      single,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );

    const partsDir = join(dir, 'parts');
    await mkdir(partsDir);
    await writeFile(
      join(partsDir, 'one.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
    );
    await writeFile(
      join(partsDir, 'two.ttl'),
      '@prefix ex: <http://example.org/> . ex:c ex:q ex:d .\n',
    );

    const fromSingle = await canonicalizeRdf({ sources: single });
    const fromGlob = await canonicalizeRdf({
      sources: [join(partsDir, '*.ttl')],
    });

    expect(fromGlob.canonicalText).toBe(fromSingle.canonicalText);
  });
});
