import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { runCli } from './helpers/run-cli';

const SPARQL_BINDINGS = JSON.stringify({
  head: { vars: ['s', 'p', 'o'] },
  results: {
    bindings: [
      {
        s: { type: 'uri', value: 'http://example.org/keep' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/v1' },
      },
    ],
  },
});

const MATERIALIZE_RE =
  /\bSELECT\s+\?s\s+\?p\s+\?o\s+WHERE\s*{\s*\?s\s+\?p\s+\?o\s*}\s*$/i;

const SCOPE_QUERY =
  'PREFIX ex: <http://example.org/> SELECT ?s ?p ?o WHERE { ?s ?p ?o FILTER(?s = ex:keep) }';

function startRecordingEndpoint(
  body: string,
): Promise<{
  endpoint: FakeSparqlEndpoint;
  captured: () => ReadonlyArray<string>;
}> {
  const captured: string[] = [];
  return startFakeSparqlEndpoint(({ query }) => {
    captured.push(query);
    return { contentType: 'application/sparql-results+json', body };
  }).then((endpoint) => ({
    endpoint,
    captured: (): ReadonlyArray<string> => captured,
  }));
}

describe('view pass-through — hash --query <q> <endpoint>', () => {
  let endpoint: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
  });

  it("forwards <q> to the endpoint and never sends the bare 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }'", async () => {
    const recording = await startRecordingEndpoint(SPARQL_BINDINGS);
    endpoint = recording.endpoint;

    const result = await runCli([
      'hash',
      '--quiet',
      '--query',
      SCOPE_QUERY,
      endpoint.url,
    ]);

    expect(result.exitCode, result.stderr).toBe(0);
    const seen = recording.captured();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((q) => q.includes('FILTER'))).toBe(true);
    expect(seen.every((q) => !MATERIALIZE_RE.test(q))).toBe(true);
  });
});

describe('view pass-through — diff --query / --left-query / --right-query', () => {
  let left: FakeSparqlEndpoint | undefined;
  let right: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (left) await left.close();
    left = undefined;
    if (right) await right.close();
    right = undefined;
  });

  it('diff --query <q>: forwards <q> to BOTH endpoints (no bare SELECT)', async () => {
    const leftRec = await startRecordingEndpoint(SPARQL_BINDINGS);
    const rightRec = await startRecordingEndpoint(SPARQL_BINDINGS);
    left = leftRec.endpoint;
    right = rightRec.endpoint;

    const result = await runCli([
      'diff',
      '--quiet',
      '--query',
      SCOPE_QUERY,
      left.url,
      right.url,
    ]);

    // Equal stores → diff exits 0; result.exitCode may be 0 or 1 depending,
    // but contacting the endpoints with the right query is what matters.
    expect([0, 1]).toContain(result.exitCode);
    for (const seen of [leftRec.captured(), rightRec.captured()]) {
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.some((q) => q.includes('FILTER'))).toBe(true);
      expect(seen.every((q) => !MATERIALIZE_RE.test(q))).toBe(true);
    }
  });

  it('diff --left-query / --right-query: each side receives its own scoped query', async () => {
    const leftRec = await startRecordingEndpoint(SPARQL_BINDINGS);
    const rightRec = await startRecordingEndpoint(SPARQL_BINDINGS);
    left = leftRec.endpoint;
    right = rightRec.endpoint;

    const LEFT_SCOPE =
      'PREFIX ex: <http://example.org/> SELECT ?s ?p ?o WHERE { ?s ?p ?o FILTER(?s = ex:keep) } # left-marker';
    const RIGHT_SCOPE =
      'PREFIX ex: <http://example.org/> SELECT ?s ?p ?o WHERE { ?s ?p ?o FILTER(?s = ex:keep) } # right-marker';

    const result = await runCli([
      'diff',
      '--quiet',
      '--left-query',
      LEFT_SCOPE,
      '--right-query',
      RIGHT_SCOPE,
      left.url,
      right.url,
    ]);

    expect([0, 1]).toContain(result.exitCode);
    expect(leftRec.captured().some((q) => q.includes('left-marker'))).toBe(true);
    expect(leftRec.captured().some((q) => q.includes('right-marker'))).toBe(false);
    expect(rightRec.captured().some((q) => q.includes('right-marker'))).toBe(true);
    expect(rightRec.captured().some((q) => q.includes('left-marker'))).toBe(false);
    for (const seen of [leftRec.captured(), rightRec.captured()]) {
      expect(seen.every((q) => !MATERIALIZE_RE.test(q))).toBe(true);
    }
  });
});

describe('view pass-through — declared view with from: @endpoint', () => {
  let endpoint: FakeSparqlEndpoint | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-view-passthrough-decl-'));
  });

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it("a declared view's query reaches the endpoint when the view is used by `query`", async () => {
    const recording = await startRecordingEndpoint(SPARQL_BINDINGS);
    endpoint = recording.endpoint;

    const configPath = join(dir, 'sparqly.query.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: ep
            endpoint: "${endpoint.url}"
          - id: snap
            from: "@ep"
            query: ${JSON.stringify(SCOPE_QUERY)}
      ` + '\n',
    );

    const result = await runCli(
      [
        'query',
        '@snap',
        '--config',
        configPath,
        '-q',
        'SELECT ?s WHERE { ?s ?p ?o }',
      ],
      { env: {} },
    );

    expect(result.exitCode, result.stderr).toBe(0);
    const seen = recording.captured();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((q) => q.includes('FILTER'))).toBe(true);
  });
});

describe('view pass-through — result equivalence', () => {
  let endpoint: FakeSparqlEndpoint | undefined;
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-view-passthrough-eq-'));
  });

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
    await rm(scratch, { recursive: true, force: true });
  });

  it('hash --query <q> <endpoint> matches hash over a glob fixture pre-loaded with the same triples', async () => {
    endpoint = (await startRecordingEndpoint(SPARQL_BINDINGS)).endpoint;
    const ttlPath = join(scratch, 'kept.ttl');
    await writeFile(
      ttlPath,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:keep ex:p ex:v1 .',
      ].join('\n') + '\n',
    );

    const viaEndpoint = await runCli([
      'hash',
      '--quiet',
      '--query',
      SCOPE_QUERY,
      endpoint.url,
    ]);
    const viaFile = await runCli(['hash', '--quiet', ttlPath]);

    expect(viaEndpoint.exitCode, viaEndpoint.stderr).toBe(0);
    expect(viaFile.exitCode, viaFile.stderr).toBe(0);
    expect(viaEndpoint.stdout.split('  ')[0]).toBe(
      viaFile.stdout.split('  ')[0],
    );
  });
});
