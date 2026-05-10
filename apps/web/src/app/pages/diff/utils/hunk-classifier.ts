import type { Hunk } from '../services/diff.service';

export type HunkClass = 'added' | 'removed' | 'changed';

export function classifyHunk(hunk: Hunk): HunkClass {
  let plus = 0;
  let minus = 0;
  for (const l of hunk.lines) {
    if (l.side === '+') plus++;
    else if (l.side === '-') minus++;
  }
  if (plus > 0 && minus === 0) return 'added';
  if (minus > 0 && plus === 0) return 'removed';
  return 'changed';
}
