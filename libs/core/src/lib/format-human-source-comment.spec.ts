import { describe, expect, it } from 'vitest';
import { formatHumanSourceComment } from './format-human-source-comment';

describe('formatHumanSourceComment', () => {
  it('emits a leading-space `# path:line[,line...]; path2:line` trailing comment', () => {
    expect(
      formatHumanSourceComment(
        [
          { file: 'file:///cwd/data/foo.ttl', line: 5 },
          { file: 'file:///cwd/data/foo.ttl', line: 12 },
          { file: 'file:///cwd/data/bar.ttl', line: 3 },
        ],
        '/cwd',
      ),
    ).toBe(' # data/foo.ttl:5,12; data/bar.ttl:3');
  });

  it('returns the empty string for no records', () => {
    expect(formatHumanSourceComment([], '/cwd')).toBe('');
  });

  it('omits the `:line` suffix for a file whose record(s) lack a line', () => {
    expect(
      formatHumanSourceComment(
        [{ file: 'file:///cwd/data/foo.ttl' }],
        '/cwd',
      ),
    ).toBe(' # data/foo.ttl');
  });
});
