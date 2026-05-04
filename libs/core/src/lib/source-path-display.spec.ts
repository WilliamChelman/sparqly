import { describe, expect, it } from 'vitest';
import { displaySourcePath } from './source-path-display';

describe('displaySourcePath', () => {
  it('returns the absolute path decoded from the file:// IRI and a CWD-relative display path', () => {
    const r = displaySourcePath('file:///abs/proj/data/foo.ttl', '/abs/proj');
    expect(r.absolutePath).toBe('/abs/proj/data/foo.ttl');
    expect(r.displayPath).toBe('data/foo.ttl');
  });
});
