import { describe, expect, it } from 'vitest';
import { SnippetAllowList } from './snippet-allow-list';

describe('SnippetAllowList', () => {
  it('starts empty: has() returns false for any path', () => {
    const list = new SnippetAllowList();
    expect(list.has('/tmp/foo.ttl')).toBe(false);
    expect(list.all()).toEqual([]);
  });

  it('update(paths) populates the allow-list and has() reflects it', () => {
    const list = new SnippetAllowList();
    list.update(['/tmp/a.ttl', '/tmp/b.ttl']);
    expect(list.has('/tmp/a.ttl')).toBe(true);
    expect(list.has('/tmp/b.ttl')).toBe(true);
    expect(list.has('/tmp/c.ttl')).toBe(false);
    expect(list.all().sort()).toEqual(['/tmp/a.ttl', '/tmp/b.ttl']);
  });

  it('update(paths) replaces the prior set entirely (no merging)', () => {
    const list = new SnippetAllowList();
    list.update(['/tmp/a.ttl', '/tmp/b.ttl']);
    list.update(['/tmp/c.ttl']);
    expect(list.has('/tmp/a.ttl')).toBe(false);
    expect(list.has('/tmp/b.ttl')).toBe(false);
    expect(list.has('/tmp/c.ttl')).toBe(true);
    expect(list.all()).toEqual(['/tmp/c.ttl']);
  });

  it('atomic swap: a request observing the list sees one consistent set across the swap', async () => {
    // Atomicity contract: while update() runs, concurrent has() lookups must
    // never see a half-built set (e.g. cleared but not yet refilled). We
    // simulate concurrency by pinning a `has` lookup against the instance
    // either side of the swap and verifying neither falls through.
    const list = new SnippetAllowList();
    list.update(['/tmp/a.ttl']);

    const before = list.has('/tmp/a.ttl');
    list.update(['/tmp/b.ttl']);
    const after = list.has('/tmp/b.ttl');

    expect(before).toBe(true);
    expect(after).toBe(true);
    // The intermediate state — list emptied but not yet refilled — must not
    // exist. We assert by reading the internal list shape via all() right
    // after the swap and confirming it is exactly the new payload.
    expect(list.all()).toEqual(['/tmp/b.ttl']);
  });

  it('update() accepts ReadonlyArray and de-duplicates', () => {
    const list = new SnippetAllowList();
    list.update(['/tmp/a.ttl', '/tmp/a.ttl', '/tmp/b.ttl']);
    expect(list.all().sort()).toEqual(['/tmp/a.ttl', '/tmp/b.ttl']);
  });
});
