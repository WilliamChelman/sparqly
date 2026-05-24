import { computeTotalsLine } from './totals-line';
import type {
  DiffResponse,
  GroupedDiffResponse,
  TabularDiffResponse,
} from '../models/diff-response';

describe('computeTotalsLine', () => {
  it('returns null for error responses', () => {
    const r: DiffResponse = { kind: 'error', errors: { top: { kind: 'legacy-message', message: 'boom' } } };
    expect(computeTotalsLine(r)).toBeNull();
  });

  it('sums hunk added/removed for grouped responses', () => {
    const r: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        totals: { left: 10, right: 12 },
        hunks: [
          { anchor: 'a', state: 'changed', added: 2, removed: 1, lines: [], sourceRecords: { left: [], right: [] } },
          { anchor: 'b', state: 'changed', added: 3, removed: 4, lines: [], sourceRecords: { left: [], right: [] } },
        ],
      },
    };
    expect(computeTotalsLine(r)).toBe('left=10 right=12 +5 -5');
  });

  it('returns a zero-delta line when a grouped response has no hunks', () => {
    const r: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: { totals: { left: 7, right: 7 }, hunks: [] },
    };
    expect(computeTotalsLine(r)).toBe('left=7 right=7 +0 -0');
  });

  it('uses tabular diff entry counts for tabular responses', () => {
    const r: TabularDiffResponse = {
      kind: 'tabular',
      totals: { left: 5, right: 6 },
      variables: ['s'],
      diff: {
        added: [
          { row: {}, count: 1 },
          { row: {}, count: 1 },
        ],
        removed: [{ row: {}, count: 1 }],
        totals: { left: 5, right: 6 },
      },
    };
    expect(computeTotalsLine(r)).toBe('left=5 right=6 +2 -1');
  });
});
