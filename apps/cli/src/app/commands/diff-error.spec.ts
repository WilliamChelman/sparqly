import { describe, expect, it } from 'vitest';
import type { DiffError } from 'core';
import {
  DiffErrorSignal,
  decorateDiffError,
  diffErrorExitCode,
} from './diff-error';

const ANSI_RED = '\x1b[31m';
const ANSI_RESET = '\x1b[0m';

describe('diffErrorExitCode — per-variant stable exit code map', () => {
  const cases: Array<{ name: string; error: DiffError; code: number }> = [
    {
      name: 'tabular-blank-node',
      error: { kind: 'tabular-blank-node', column: 'x' },
      code: 10,
    },
    {
      name: 'unknown-source-id',
      error: {
        kind: 'unknown-source-id',
        side: 'left',
        id: 'nope',
        availableIds: [],
      },
      code: 11,
    },
    {
      name: 'mixed-shape',
      error: {
        kind: 'mixed-shape',
        triplesSide: 'left',
        tuplesSide: 'right',
      },
      code: 12,
    },
    {
      name: 'set-mismatch',
      error: { kind: 'set-mismatch', left: ['o'], right: ['s', 'o'] },
      code: 13,
    },
    {
      name: 'endpoint-as-diff-target',
      error: {
        kind: 'endpoint-as-diff-target',
        side: 'right',
        endpoint: 'https://example.org/sparql',
      },
      code: 14,
    },
    {
      name: 'inline-upstream-kind',
      error: {
        kind: 'inline-upstream-kind',
        side: 'left',
        targetKind: 'view',
      },
      code: 15,
    },
    {
      name: 'anonymous-view-execution',
      error: {
        kind: 'anonymous-view-execution',
        side: 'left',
        message: 'parse failed',
      },
      code: 20,
    },
    {
      name: 'anonymous-select-execution',
      error: {
        kind: 'anonymous-select-execution',
        side: 'right',
        message: 'select failed',
      },
      code: 21,
    },
    {
      name: 'source/reference-target',
      error: {
        kind: 'source',
        side: 'left',
        source: { kind: 'reference-target' },
      },
      code: 30,
    },
    {
      name: 'source/transform-parse',
      error: {
        kind: 'source',
        side: 'left',
        source: {
          kind: 'transform-parse',
          transformKey: 'graphName',
          message: 'unknown mode "bogus"',
        },
      },
      code: 38,
    },
    {
      name: 'legacy-message',
      error: { kind: 'legacy-message', message: 'some leftover throw' },
      code: 40,
    },
  ];

  for (const { name, error, code } of cases) {
    it(`maps ${name} to exit code ${code}`, () => {
      expect(diffErrorExitCode(error)).toBe(code);
    });
  }

  it('returns distinct codes per variant (no collisions in the map)', () => {
    const codes = cases.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('decorateDiffError — ANSI decoration layered around formatDiffError', () => {
  it('wraps the formatter output in red ANSI when color is enabled', () => {
    const body = decorateDiffError(
      { kind: 'tabular-blank-node', column: 'x' },
      { color: true },
    );
    expect(body.startsWith(ANSI_RED)).toBe(true);
    expect(body.endsWith(ANSI_RESET)).toBe(true);
    // wording must come from the shared formatter (no CLI-local copy):
    expect(body).toMatch(/\?x/);
    expect(body).toMatch(/blank node/i);
  });

  it('returns the bare formatter output when color is disabled', () => {
    const body = decorateDiffError(
      { kind: 'tabular-blank-node', column: 'x' },
      { color: false },
    );
    expect(body).not.toContain(ANSI_RED);
    expect(body).not.toContain(ANSI_RESET);
    expect(body).toMatch(/\?x/);
  });

  it('does not duplicate or rewrite the formatter wording (golden — tabular-blank-node)', () => {
    const plain = decorateDiffError(
      { kind: 'tabular-blank-node', column: 'name' },
      { color: false },
    );
    // exact wording owned by core/formatDiffError; the CLI must not paraphrase
    expect(plain).toBe(
      'tabular diff cannot key a row with a blank-node-valued column ?name: blank nodes have no cross-side identity. Project a stable IRI or literal in your SELECT (e.g. via a deterministic IRI mint or by selecting an identifying property) instead.',
    );
  });

  it('does not duplicate or rewrite the formatter wording (golden — anonymous-view-execution transport)', () => {
    const plain = decorateDiffError(
      {
        kind: 'anonymous-view-execution',
        side: 'left',
        message: 'comunica: bad query',
      },
      { color: false },
    );
    expect(plain).toBe('comunica: bad query');
  });
});

describe('golden surface — shape error + transport error (wording + exit code)', () => {
  it('tabular-blank-node (shape): plain wording + decorated wording + exit code 10', () => {
    const error: DiffError = { kind: 'tabular-blank-node', column: 'name' };
    expect(decorateDiffError(error, { color: false })).toBe(
      'tabular diff cannot key a row with a blank-node-valued column ?name: blank nodes have no cross-side identity. Project a stable IRI or literal in your SELECT (e.g. via a deterministic IRI mint or by selecting an identifying property) instead.',
    );
    expect(decorateDiffError(error, { color: true })).toBe(
      `${ANSI_RED}tabular diff cannot key a row with a blank-node-valued column ?name: blank nodes have no cross-side identity. Project a stable IRI or literal in your SELECT (e.g. via a deterministic IRI mint or by selecting an identifying property) instead.${ANSI_RESET}`,
    );
    expect(diffErrorExitCode(error)).toBe(10);
  });

  it('anonymous-view-execution (transport): plain wording + decorated wording + exit code 20', () => {
    const error: DiffError = {
      kind: 'anonymous-view-execution',
      side: 'left',
      message: 'comunica: bad query',
    };
    expect(decorateDiffError(error, { color: false })).toBe(
      'comunica: bad query',
    );
    expect(decorateDiffError(error, { color: true })).toBe(
      `${ANSI_RED}comunica: bad query${ANSI_RESET}`,
    );
    expect(diffErrorExitCode(error)).toBe(20);
  });
});

describe('DiffErrorSignal — silent wrapper carrying a DiffError', () => {
  it('is silent so the runner skips the default `error: …` line (CLI prints decorated text itself)', () => {
    const signal = new DiffErrorSignal({
      kind: 'tabular-blank-node',
      column: 'x',
    });
    expect(signal.silent).toBe(true);
  });

  it('exposes the wrapped DiffError so diffSpec.exitCode can read its variant', () => {
    const error: DiffError = {
      kind: 'endpoint-as-diff-target',
      side: 'left',
      endpoint: 'https://example.org/sparql',
    };
    const signal = new DiffErrorSignal(error);
    expect(signal.diffError).toBe(error);
  });

  it("carries the formatted message so a fallthrough `e.message` log isn't empty", () => {
    const signal = new DiffErrorSignal({
      kind: 'tabular-blank-node',
      column: 'x',
    });
    expect(signal.message).toMatch(/blank node/i);
    expect(signal.name).toBe('DiffErrorSignal');
  });
});
