import { describe, expect, it } from 'vitest';
import type { SourceError, TargetError } from 'core';
import {
  FormatErrorSignal,
  decorateFormatError,
  formatErrorExitCode,
} from './format-error';

const ANSI_RED = '\x1b[31m';
const ANSI_RESET = '\x1b[0m';

describe('formatErrorExitCode — per-variant stable exit code map', () => {
  const cases: Array<{
    name: string;
    error: SourceError | TargetError;
    code: number;
  }> = [
    { name: 'source/reference-target', error: { kind: 'reference-target' }, code: 30 },
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
    { name: 'target/ref-as-target', error: { kind: 'ref-as-target' }, code: 50 },
    { name: 'target/empty-registry', error: { kind: 'empty-registry' }, code: 51 },
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
      expect(formatErrorExitCode(error)).toBe(code);
    });
  }

  it('returns distinct codes per variant (no collisions in the map)', () => {
    const codes = cases.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('decorateFormatError — ANSI decoration over shared format*Error', () => {
  it('wraps the formatter output in red ANSI when color is enabled', () => {
    const body = decorateFormatError(
      {
        kind: 'transform-parse',
        transformKey: 'graphName',
        message: 'unknown mode "bogus"',
      },
      { color: true },
    );
    expect(body.startsWith(ANSI_RED)).toBe(true);
    expect(body.endsWith(ANSI_RESET)).toBe(true);
    expect(body).toContain('graphName');
    expect(body).toContain('unknown mode "bogus"');
  });

  it('returns the bare formatter output when color is disabled (transform-parse golden)', () => {
    const body = decorateFormatError(
      {
        kind: 'transform-parse',
        transformKey: 'annotateSource',
        message: 'iri override must not be empty',
      },
      { color: false },
    );
    expect(body).toBe('`annotateSource`: iri override must not be empty');
  });
});

describe('FormatErrorSignal — silent wrapper carrying SourceError | TargetError', () => {
  it('is silent so the runner skips the default `error: …` line', () => {
    const signal = new FormatErrorSignal({
      kind: 'glob-load',
      glob: ['data/*.ttl'],
      message: 'x',
    });
    expect(signal.silent).toBe(true);
  });

  it('exposes the wrapped error so formatSpec.exitCode can read its variant', () => {
    const error: SourceError = {
      kind: 'transform-parse',
      transformKey: 'graphName',
      message: 'unknown mode',
    };
    const signal = new FormatErrorSignal(error);
    expect(signal.formatError).toBe(error);
  });

  it("carries the formatted message so a fallthrough `e.message` log isn't empty", () => {
    const signal = new FormatErrorSignal({
      kind: 'transform-parse',
      transformKey: 'graphName',
      message: 'bad',
    });
    expect(signal.message).toMatch(/graphName/);
    expect(signal.name).toBe('FormatErrorSignal');
  });
});
