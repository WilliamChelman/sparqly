import { describe, expect, it } from 'vitest';
import { formatDiffError } from './errors';

describe('formatDiffError', () => {
  it('formats tabular-blank-node naming the offending column and explaining why', () => {
    const message = formatDiffError({
      kind: 'tabular-blank-node',
      column: 'x',
    });
    expect(message).toMatch(/\?x/);
    expect(message).toMatch(/blank node/i);
    expect(message).toMatch(/cross-side|identity/i);
  });

  it('formats unknown-source-id naming the offending id, side, and available list', () => {
    const message = formatDiffError({
      kind: 'unknown-source-id',
      side: 'left',
      id: 'nope',
      availableIds: ['alpha', 'beta'],
    });
    expect(message).toMatch(/"nope"/);
    expect(message).toMatch(/left side/);
    expect(message).toMatch(/@alpha/);
    expect(message).toMatch(/@beta/);
  });

  it('formats unknown-source-id with "(none)" when registry is empty', () => {
    const message = formatDiffError({
      kind: 'unknown-source-id',
      side: 'right',
      id: 'x',
      availableIds: [],
    });
    expect(message).toMatch(/\(none\)/);
  });

  it('formats mixed-shape calling out which side is triples and which is tuples', () => {
    const message = formatDiffError({
      kind: 'mixed-shape',
      triplesSide: 'left',
      tuplesSide: 'right',
    });
    expect(message).toMatch(/mixed-shape/i);
    expect(message).toMatch(/left-side.*triples/);
    expect(message).toMatch(/right-side.*tuples/);
  });

  it('formats set-mismatch listing both projected variable sets sorted with ? prefix', () => {
    const message = formatDiffError({
      kind: 'set-mismatch',
      left: ['o'],
      right: ['subject', 'o'],
    });
    expect(message).toMatch(/variable-name sets/);
    expect(message).toMatch(/\{\?o\}/);
    expect(message).toMatch(/\{\?o, \?subject\}/);
  });

  it('formats endpoint-as-diff-target naming the endpoint URL and the offending side', () => {
    const message = formatDiffError({
      kind: 'endpoint-as-diff-target',
      side: 'left',
      endpoint: 'https://example.org/sparql',
    });
    expect(message).toMatch(/https:\/\/example\.org\/sparql/);
    expect(message).toMatch(/left side/);
    expect(message).toMatch(/view|leftQuery/);
  });

  it('formats inline-upstream-kind naming the offending source kind', () => {
    const message = formatDiffError({
      kind: 'inline-upstream-kind',
      side: 'right',
      targetKind: 'view',
    });
    expect(message).toMatch(/right target/);
    expect(message).toMatch(/view source/);
  });

  it('formats anonymous-view-execution as the wrapped message verbatim', () => {
    const message = formatDiffError({
      kind: 'anonymous-view-execution',
      side: 'left',
      message: 'parse failed at line 1',
    });
    expect(message).toBe('parse failed at line 1');
  });

  it('formats anonymous-select-execution as the wrapped message verbatim', () => {
    const message = formatDiffError({
      kind: 'anonymous-select-execution',
      side: 'right',
      message: 'comunica failed: bad query',
    });
    expect(message).toBe('comunica failed: bad query');
  });

  it('formats source by delegating to formatSourceError', () => {
    const message = formatDiffError({
      kind: 'source',
      side: 'left',
      source: {
        kind: 'glob-load',
        glob: ['/tmp/*.ttl'],
        message: 'cannot read file foo.ttl',
      },
    });
    expect(message).toBe('cannot read file foo.ttl');
  });

  it('formats legacy-message by passing the wrapped message through verbatim', () => {
    const message = formatDiffError({
      kind: 'legacy-message',
      message: 'unknown @id "foo" on left side',
    });
    expect(message).toBe('unknown @id "foo" on left side');
  });
});
