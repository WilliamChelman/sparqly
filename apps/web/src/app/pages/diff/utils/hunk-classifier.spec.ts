import { classifyHunk } from './hunk-classifier';
import type { Hunk, HunkLine } from '../services/diff.service';

function line(side: '-' | '+'): HunkLine {
  return {
    side,
    subjectPath: 'http://example.org/s',
    predicate: 'http://example.org/p',
    object: '"x"',
    nquad: '<http://example.org/s> <http://example.org/p> "x" .',
  };
}

function hunkWith(lines: HunkLine[]): Hunk {
  return {
    anchor: 'http://example.org/s',
    state: 'changed',
    removed: lines.filter((l) => l.side === '-').length,
    added: lines.filter((l) => l.side === '+').length,
    lines,
    sourceRecords: { left: [], right: [] },
  };
}

describe('classifyHunk', () => {
  it('returns "added" when all lines are +', () => {
    expect(classifyHunk(hunkWith([line('+'), line('+')]))).toBe('added');
  });

  it('returns "removed" when all lines are -', () => {
    expect(classifyHunk(hunkWith([line('-'), line('-')]))).toBe('removed');
  });

  it('returns "changed" when both - and + are present', () => {
    expect(classifyHunk(hunkWith([line('-'), line('+')]))).toBe('changed');
  });

  it('returns "changed" for an empty hunk (degenerate)', () => {
    expect(classifyHunk(hunkWith([]))).toBe('changed');
  });

  it('does not consult the server-provided hunk.state field', () => {
    const h: Hunk = {
      anchor: 'http://example.org/s',
      state: 'removed',
      removed: 0,
      added: 2,
      lines: [line('+'), line('+')],
      sourceRecords: { left: [], right: [] },
    };
    expect(classifyHunk(h)).toBe('added');
  });
});
