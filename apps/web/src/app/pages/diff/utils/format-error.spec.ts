import { formatDiffError, formatTargetError } from './format-error';
import type { DiffError, TargetError } from '../models/diff-error';

describe('formatDiffError', () => {
  it('explains the tabular-blank-node variant with the offending column', () => {
    const msg = formatDiffError({ kind: 'tabular-blank-node', column: 'x' });
    expect(msg).toContain('?x');
    expect(msg).toContain('blank-node');
  });

  it('delegates target-wrapped variants to formatTargetError', () => {
    const err: DiffError = {
      kind: 'target',
      side: 'left',
      target: { kind: 'unknown-ref', ref: '@foo', availableIds: ['a', 'b'] },
    };
    expect(formatDiffError(err)).toBe(formatTargetError(err.target));
  });

  it('passes through legacy-message text verbatim', () => {
    expect(formatDiffError({ kind: 'legacy-message', message: 'boom' })).toBe('boom');
  });
});

describe('formatTargetError', () => {
  it('rejects reference-as-target with a stable explanation', () => {
    expect(formatTargetError({ kind: 'ref-as-target' })).toMatch(/aliases.*not.*data/);
  });

  it('reports an empty registry as a no-target condition', () => {
    expect(formatTargetError({ kind: 'empty-registry' })).toMatch(/registry is empty/);
  });

  it('lists @-prefixed ids for no-default-multi', () => {
    const msg = formatTargetError({
      kind: 'no-default-multi',
      availableIds: ['a', 'b'],
    });
    expect(msg).toContain('@a, @b');
    expect(msg).toMatch(/default: true/);
  });

  it('names the unknown ref and lists @-prefixed alternatives', () => {
    const msg = formatTargetError({
      kind: 'unknown-ref',
      ref: '@foo',
      availableIds: ['x'],
    });
    expect(msg).toContain('@foo');
    expect(msg).toContain('@x');
  });

  it('renders <none> when the available list is empty', () => {
    const cases: TargetError[] = [
      { kind: 'no-default-multi', availableIds: [] },
      { kind: 'unknown-ref', ref: '@whatever', availableIds: [] },
    ];
    for (const c of cases) expect(formatTargetError(c)).toContain('<none>');
  });
});
