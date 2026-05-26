import { describe, expect, it } from 'vitest';
import type { ParsedSource } from '../sources';
import { viewChainPassThroughSource } from './view-chain-pass-through';

const endpoint = (id: string, url: string): ParsedSource => ({
  kind: 'endpoint',
  id,
  endpoint: url,
});

const diskGlob = (id: string, glob: string): ParsedSource => ({
  kind: 'glob',
  id,
  glob,
  storage: 'disk',
});

const memGlob = (id: string, glob: string): ParsedSource => ({
  kind: 'glob',
  id,
  glob,
});

const view = (id: string, from: string): ParsedSource => ({
  kind: 'view',
  id,
  from,
  query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
});

describe('viewChainPassThroughSource', () => {
  it('returns undefined for a non-view target (raw endpoint/disk-backed are rejected upstream)', () => {
    expect(viewChainPassThroughSource(endpoint('e', 'https://x/sparql'), []))
      .toBeUndefined();
    expect(viewChainPassThroughSource(diskGlob('d', 'data/*.ttl'), []))
      .toBeUndefined();
  });

  it('returns endpoint when a one-step view bottoms on an endpoint', () => {
    const registry: ParsedSource[] = [
      endpoint('live', 'https://example.org/sparql'),
      view('v', 'live'),
    ];
    expect(viewChainPassThroughSource(registry[1], registry)).toEqual({
      kind: 'endpoint',
      url: 'https://example.org/sparql',
    });
  });

  it('returns disk-backed-glob when a one-step view bottoms on a disk-backed glob', () => {
    const registry: ParsedSource[] = [
      diskGlob('big', 'huge/**/*.ttl'),
      view('v', 'big'),
    ];
    expect(viewChainPassThroughSource(registry[1], registry)).toEqual({
      kind: 'disk-backed-glob',
      label: '@big',
    });
  });

  it('walks through intermediate views to find the leaf pass-through source', () => {
    const registry: ParsedSource[] = [
      diskGlob('big', 'huge/**/*.ttl'),
      view('mid', 'big'),
      view('outer', 'mid'),
    ];
    expect(viewChainPassThroughSource(registry[2], registry)).toEqual({
      kind: 'disk-backed-glob',
      label: '@big',
    });
  });

  it('returns undefined when the chain bottoms on an in-memory glob (no pass-through)', () => {
    const registry: ParsedSource[] = [
      memGlob('local', 'data/*.ttl'),
      view('v', 'local'),
    ];
    expect(viewChainPassThroughSource(registry[1], registry)).toBeUndefined();
  });

  it('returns undefined when the chain bottoms on empty', () => {
    const registry: ParsedSource[] = [
      { kind: 'empty', id: 'e' },
      view('v', 'e'),
    ];
    expect(viewChainPassThroughSource(registry[1], registry)).toBeUndefined();
  });

  it('returns undefined when an upstream reference is unknown (resolution will error elsewhere)', () => {
    const registry: ParsedSource[] = [view('v', 'missing')];
    expect(viewChainPassThroughSource(registry[0], registry)).toBeUndefined();
  });
});
