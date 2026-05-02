import { describe, expect, it } from 'vitest';
import { substituteSourceEnv } from './env-substitute';

describe('substituteSourceEnv — tracer bullet', () => {
  it('expands ${VAR} inside a string entry of sources[]', () => {
    const out = substituteSourceEnv(['https://example.com/${HOST}/sparql'], {
      env: { HOST: 'live' },
    });
    expect(out).toEqual(['https://example.com/live/sparql']);
  });
});

describe('substituteSourceEnv — recursion into nested fields', () => {
  it('expands strings inside auth, headers, prefilter, endpoint, graph', () => {
    const out = substituteSourceEnv(
      [
        {
          endpoint: 'https://${HOST}/sparql',
          graph: 'urn:graph:${HOST}',
          prefilter: 'CONSTRUCT { ?s ?p "${LABEL}" } WHERE { ?s ?p ?o }',
          auth: { type: 'bearer', token: '${TOKEN}' },
          headers: { 'X-Tenant': '${TENANT}' },
        },
      ],
      {
        env: {
          HOST: 'live',
          LABEL: 'hi',
          TOKEN: 'tk-1',
          TENANT: 'acme',
        },
      },
    );
    expect(out).toEqual([
      {
        endpoint: 'https://live/sparql',
        graph: 'urn:graph:live',
        prefilter: 'CONSTRUCT { ?s ?p "hi" } WHERE { ?s ?p ?o }',
        auth: { type: 'bearer', token: 'tk-1' },
        headers: { 'X-Tenant': 'acme' },
      },
    ]);
  });

  it('walks into arrays of strings inside a sources entry', () => {
    const out = substituteSourceEnv(
      [{ glob: 'data/*.ttl', mirrors: ['https://${HOST}/a', 'https://${HOST}/b'] }],
      { env: { HOST: 'live' } },
    );
    expect(out).toEqual([
      { glob: 'data/*.ttl', mirrors: ['https://live/a', 'https://live/b'] },
    ]);
  });

  it('does not mutate the input array or its entries', () => {
    const input: unknown[] = [
      { endpoint: 'https://${HOST}/sparql', headers: { 'X-Tenant': '${TENANT}' } },
    ];
    const before = JSON.parse(JSON.stringify(input));
    substituteSourceEnv(input, { env: { HOST: 'live', TENANT: 'acme' } });
    expect(input).toEqual(before);
  });

  it('leaves non-string scalars untouched', () => {
    const out = substituteSourceEnv(
      [{ endpoint: 'https://${HOST}/sparql', timeoutMs: 30000, mutable: false }],
      { env: { HOST: 'live' } },
    );
    expect(out).toEqual([
      { endpoint: 'https://live/sparql', timeoutMs: 30000, mutable: false },
    ]);
  });
});

describe('substituteSourceEnv — escape syntax', () => {
  it('escapes $${...} to a literal ${...} without consulting env', () => {
    const out = substituteSourceEnv(
      [{ prefilter: 'PREFIX ex: <https://ex/> SELECT $${ROW} WHERE { ?s ?p ?o }' }],
      { env: {} },
    );
    expect(out).toEqual([
      { prefilter: 'PREFIX ex: <https://ex/> SELECT ${ROW} WHERE { ?s ?p ?o }' },
    ]);
  });

  it('mixes escapes and real expansions in one string', () => {
    const out = substituteSourceEnv(
      ['hello ${NAME}, literal $${KEEP} done'],
      { env: { NAME: 'world' } },
    );
    expect(out).toEqual(['hello world, literal ${KEEP} done']);
  });
});

describe('substituteSourceEnv — error reporting', () => {
  it('throws when ${VAR} references a missing env var, including the name and a JSON pointer', () => {
    expect(() =>
      substituteSourceEnv(
        [{ auth: { type: 'bearer', token: '${MISSING}' } }],
        { env: {} },
      ),
    ).toThrow(/MISSING.*\/sources\/0\/auth\/token/);
  });

  it('throws when ${VAR} resolves to an empty string', () => {
    expect(() =>
      substituteSourceEnv(['https://example.com/${HOST}/sparql'], {
        env: { HOST: '' },
      }),
    ).toThrow(/HOST.*\/sources\/0/);
  });

  it('escapes JSON-pointer special characters (~, /) in the path', () => {
    expect(() =>
      substituteSourceEnv(
        [{ headers: { 'a/b~c': '${MISSING}' } }],
        { env: {} },
      ),
    ).toThrow(/\/sources\/0\/headers\/a~1b~0c/);
  });

  it('throws on an unclosed ${ with the JSON pointer of the offending string', () => {
    expect(() =>
      substituteSourceEnv(
        [{ endpoint: 'https://example.com/${UNCLOSED' }],
        { env: { UNCLOSED: 'x' } },
      ),
    ).toThrow(/unclosed.*\/sources\/0\/endpoint/i);
  });
});
