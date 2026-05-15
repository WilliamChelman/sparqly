import { describe, expect, it } from 'vitest';
import type {
  ParsedEndpointSource,
  ParsedGlobSource,
  ParsedViewSource,
} from 'core';
import { applyAtOverride, AtOverrideError } from './at-override';

const GLOB: ParsedGlobSource = { kind: 'glob', glob: 'data/*.ttl' };
const PINNED_GLOB: ParsedGlobSource = {
  kind: 'glob',
  glob: 'data/*.ttl',
  gitRef: 'v1.0.0',
};
const ENDPOINT: ParsedEndpointSource = {
  kind: 'endpoint',
  endpoint: 'https://example.org/sparql',
  id: 'live',
};
const VIEW: ParsedViewSource = {
  kind: 'view',
  id: 'people',
  from: 'data',
  query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
};

describe('applyAtOverride', () => {
  it('returns the target unchanged when `at` is undefined', () => {
    expect(applyAtOverride(GLOB, undefined)).toBe(GLOB);
    expect(applyAtOverride(PINNED_GLOB, undefined)).toBe(PINNED_GLOB);
  });

  it('sets gitRef on a glob target with no declared gitRef', () => {
    const result = applyAtOverride(GLOB, 'v1.2.0');
    expect(result).toEqual({ ...GLOB, gitRef: 'v1.2.0' });
  });

  it('overrides any declared gitRef on a glob target', () => {
    const result = applyAtOverride(PINNED_GLOB, 'v2.0.0');
    expect(result).toMatchObject({ kind: 'glob', gitRef: 'v2.0.0' });
  });

  it('throws AtOverrideError for an endpoint target', () => {
    expect(() => applyAtOverride(ENDPOINT, 'v1.2.0')).toThrow(AtOverrideError);
    expect(() => applyAtOverride(ENDPOINT, 'v1.2.0')).toThrow(/--at applies only to glob/);
  });

  it('sets fromGitRef on a view target so propagation walks the from: chain', () => {
    const result = applyAtOverride(VIEW, 'v1.2.0');
    expect(result).toEqual({ ...VIEW, fromGitRef: 'v1.2.0' });
  });

  it('overrides any declared fromGitRef on a view target', () => {
    const declared: ParsedViewSource = { ...VIEW, fromGitRef: 'declared' };
    const result = applyAtOverride(declared, 'v2.0.0');
    expect(result).toMatchObject({ kind: 'view', fromGitRef: 'v2.0.0' });
  });
});
