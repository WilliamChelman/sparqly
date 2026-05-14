import { describe, expect, it } from 'vitest';
import type { SourceError, TargetError } from 'core';
import {
  QueryErrorSignal,
  decorateQueryError,
  queryErrorExitCode,
} from './query-error';

const ANSI_RED = '\x1b[31m';
const ANSI_RESET = '\x1b[0m';

describe('queryErrorExitCode — per-variant stable exit code map', () => {
  const cases: Array<{
    name: string;
    error: SourceError | TargetError;
    code: number;
  }> = [
    {
      name: 'source/reference-target',
      error: { kind: 'reference-target' },
      code: 30,
    },
    {
      name: 'source/glob-load',
      error: { kind: 'glob-load', glob: ['data/*.ttl'], message: 'oops' },
      code: 32,
    },
    {
      name: 'source/query-execution',
      error: { kind: 'query-execution', query: 'SELECT *', message: 'bad' },
      code: 33,
    },
    {
      name: 'source/endpoint-fetch',
      error: {
        kind: 'endpoint-fetch',
        endpoint: 'https://example.org/sparql',
        message: 'unreachable',
      },
      code: 34,
    },
    {
      name: 'source/view-validation',
      error: { kind: 'view-validation', message: 'bad view' },
      code: 35,
    },
    {
      name: 'source/view-reference',
      error: {
        kind: 'view-reference',
        viewId: 'v',
        ref: '@nope',
        reason: 'unknown',
        message: 'missing',
      },
      code: 36,
    },
    {
      name: 'source/cache-io',
      error: { kind: 'cache-io', cachePath: '/tmp/c', message: 'eio' },
      code: 37,
    },
    {
      name: 'source/transform-parse',
      error: {
        kind: 'transform-parse',
        transformKey: 'graphName',
        message: 'unknown mode',
      },
      code: 38,
    },
    {
      name: 'target/ref-as-target',
      error: { kind: 'ref-as-target' },
      code: 50,
    },
    {
      name: 'target/empty-registry',
      error: { kind: 'empty-registry' },
      code: 51,
    },
    {
      name: 'target/no-default-multi',
      error: { kind: 'no-default-multi', availableIds: ['a', 'b'] },
      code: 52,
    },
    {
      name: 'target/unknown-ref',
      error: { kind: 'unknown-ref', ref: '@nope', availableIds: [] },
      code: 53,
    },
  ];

  for (const { name, error, code } of cases) {
    it(`maps ${name} to exit code ${code}`, () => {
      expect(queryErrorExitCode(error)).toBe(code);
    });
  }

  it('returns distinct codes per variant (no collisions in the map)', () => {
    const codes = cases.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('decorateQueryError — ANSI decoration over shared format*Error', () => {
  it('wraps the formatter output in red ANSI when color is enabled', () => {
    const body = decorateQueryError(
      { kind: 'glob-load', glob: ['data/*.ttl'], message: 'parse failed' },
      { color: true },
    );
    expect(body.startsWith(ANSI_RED)).toBe(true);
    expect(body.endsWith(ANSI_RESET)).toBe(true);
    expect(body).toContain('parse failed');
  });

  it('returns the bare formatter output when color is disabled', () => {
    const body = decorateQueryError(
      { kind: 'glob-load', glob: ['data/*.ttl'], message: 'parse failed' },
      { color: false },
    );
    expect(body).not.toContain(ANSI_RED);
    expect(body).not.toContain(ANSI_RESET);
    expect(body).toContain('parse failed');
  });

  it('uses shared formatSourceError wording for a source variant (no CLI paraphrase)', () => {
    const plain = decorateQueryError(
      {
        kind: 'endpoint-fetch',
        endpoint: 'https://example.org/sparql',
        message: 'ECONNREFUSED',
      },
      { color: false },
    );
    expect(plain).toBe(
      'endpoint https://example.org/sparql: ECONNREFUSED',
    );
  });

  it('uses shared formatTargetError wording for a target variant (no CLI paraphrase)', () => {
    const plain = decorateQueryError(
      { kind: 'unknown-ref', ref: '@nope', availableIds: ['files'] },
      { color: false },
    );
    expect(plain).toBe('no source matches @nope. Available: @files');
  });
});

describe('QueryErrorSignal — silent wrapper carrying SourceError | TargetError', () => {
  it('is silent so the runner skips the default `error: …` line', () => {
    const signal = new QueryErrorSignal({
      kind: 'glob-load',
      glob: ['data/*.ttl'],
      message: 'x',
    });
    expect(signal.silent).toBe(true);
  });

  it('exposes the wrapped error so querySpec.exitCode can read its variant', () => {
    const error: SourceError = {
      kind: 'endpoint-fetch',
      endpoint: 'https://example.org/sparql',
      message: 'down',
    };
    const signal = new QueryErrorSignal(error);
    expect(signal.queryError).toBe(error);
  });

  it("carries the formatted message so a fallthrough `e.message` log isn't empty", () => {
    const signal = new QueryErrorSignal({
      kind: 'unknown-ref',
      ref: '@nope',
      availableIds: [],
    });
    expect(signal.message).toMatch(/no source matches @nope/);
    expect(signal.name).toBe('QueryErrorSignal');
  });
});
