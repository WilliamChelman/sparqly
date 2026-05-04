import { describe, expect, it } from 'vitest';
import { composeHtmlDiff } from './html-diff-composer';

const t = (iri: string): string => `<http://example.org/${iri}>`;
const triple = (s: string, p: string, o: string): string =>
  `${t(s)} ${t(p)} ${t(o)} .`;

const emptySnippets = new Map();

describe('composeHtmlDiff', () => {
  it('emits a single self-contained HTML5 document with inline style and no JS or external resources', () => {
    const out = composeHtmlDiff(
      { added: [], removed: [] },
      { left: new Map(), right: new Map() },
      emptySnippets,
      { cwd: '/cwd' },
    );

    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toMatch(/<html\b/);
    expect(out).toMatch(/<\/html>\s*$/);
    expect(out).toContain('<style>');
    expect(out).not.toContain('<script');
    expect(out).not.toMatch(/<link\b/);
    expect(out).not.toMatch(/\bsrc=/);
    expect(out).not.toMatch(/\bhttp:\/\//);
  });

  it('renders one removed and one added hunk with the canonical N-Quad statement, in `removed` then `added` order', () => {
    const removed = triple('c', 'q', 'd');
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [removed] },
      { left: new Map(), right: new Map() },
      emptySnippets,
      { cwd: '/cwd' },
    );

    const removedIdx = out.indexOf(
      '&lt;http://example.org/c&gt; &lt;http://example.org/q&gt; &lt;http://example.org/d&gt; .',
    );
    const addedIdx = out.indexOf(
      '&lt;http://example.org/e&gt; &lt;http://example.org/r&gt; &lt;http://example.org/f&gt; .',
    );
    expect(removedIdx).toBeGreaterThan(0);
    expect(addedIdx).toBeGreaterThan(removedIdx);
  });

  it('renders per-record file references for each hunk: removed draws from left, added from right', () => {
    const removed = triple('c', 'q', 'd');
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [removed] },
      {
        left: new Map([
          [removed, [{ file: 'file:///cwd/a.ttl', line: 7 }]],
        ]),
        right: new Map([
          [added, [{ file: 'file:///cwd/b.ttl', line: 3 }]],
        ]),
      },
      emptySnippets,
      { cwd: '/cwd' },
    );

    // Display path is relative to CWD.
    expect(out).toContain('a.ttl:7');
    expect(out).toContain('b.ttl:3');
    // href target is absolute (file://...).
    expect(out).toContain('href="file:///cwd/a.ttl"');
    expect(out).toContain('href="file:///cwd/b.ttl"');
  });

  it('emits anchor IDs of the form `<basename>-L<line>` on each per-record block', () => {
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [] },
      {
        left: new Map(),
        right: new Map([[added, [{ file: 'file:///cwd/foo.ttl', line: 5 }]]]),
      },
      emptySnippets,
      { cwd: '/cwd' },
    );

    expect(out).toContain('id="foo.ttl-L5"');
  });

  it('emits anchor ID `<basename>` (no -L suffix) when the record has no line number', () => {
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [] },
      {
        left: new Map(),
        right: new Map([[added, [{ file: 'file:///cwd/foo.jsonld' }]]]),
      },
      emptySnippets,
      { cwd: '/cwd' },
    );

    expect(out).toContain('id="foo.jsonld"');
    expect(out).not.toContain('foo.jsonld-L');
    // Display text omits the colon-line suffix.
    expect(out).not.toMatch(/foo\.jsonld:/);
    expect(out).toContain('>foo.jsonld<');
  });

  it('escapes HTML special characters in the canonical statement so raw `<>&"` cannot break out', () => {
    // Construct a statement with an attribute-like substring that would
    // otherwise break the document if not escaped.
    const literal = `<http://example.org/s> <http://example.org/p> "a<b&c\\"d" .`;
    const out = composeHtmlDiff(
      { added: [literal], removed: [] },
      { left: new Map(), right: new Map() },
      emptySnippets,
      { cwd: '/cwd' },
    );

    expect(out).toContain('&lt;http://example.org/s&gt;');
    expect(out).toContain('a&lt;b&amp;c\\&quot;d');
    // The raw brackets around the IRI must not appear unescaped in body.
    const bodyStart = out.indexOf('<body');
    const bodyEnd = out.lastIndexOf('</body>');
    const body = out.slice(bodyStart, bodyEnd);
    expect(body).not.toMatch(/<http:\/\/example\.org\/s>/);
  });

  it('renders a hunk for an added statement with no records (records map empty for that key)', () => {
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [] },
      { left: new Map(), right: new Map() },
      emptySnippets,
      { cwd: '/cwd' },
    );

    // Statement still rendered.
    expect(out).toContain(
      '&lt;http://example.org/e&gt; &lt;http://example.org/r&gt; &lt;http://example.org/f&gt; .',
    );
  });

  it('is byte-deterministic for the same inputs across invocations (pure function)', () => {
    const removed = triple('c', 'q', 'd');
    const added = triple('e', 'r', 'f');
    const args = [
      { added: [added], removed: [removed] },
      {
        left: new Map([[removed, [{ file: 'file:///cwd/a.ttl', line: 7 }]]]),
        right: new Map([[added, [{ file: 'file:///cwd/b.ttl', line: 3 }]]]),
      },
      emptySnippets,
      { cwd: '/cwd' },
    ] as const;

    const a = composeHtmlDiff(...args);
    const b = composeHtmlDiff(...args);
    expect(a).toBe(b);
  });

  it('renders a <pre> snippet with line-numbered gutter and focal-line highlight when a snippet is provided', () => {
    const added = triple('e', 'r', 'f');
    const snippets = new Map([
      [
        'file:///cwd/foo.ttl:5',
        {
          kind: 'snippet' as const,
          startLine: 3,
          focalLine: 5,
          lines: ['L3', 'L4', 'L5', 'L6', 'L7'],
        },
      ],
    ]);
    const out = composeHtmlDiff(
      { added: [added], removed: [] },
      {
        left: new Map(),
        right: new Map([[added, [{ file: 'file:///cwd/foo.ttl', line: 5 }]]]),
      },
      snippets,
      { cwd: '/cwd' },
    );

    // <pre> snippet block emitted for the record.
    expect(out).toMatch(/<pre[^>]*class="snippet"/);
    // Gutter contains every 1-based line number in the window.
    for (const n of [3, 4, 5, 6, 7]) {
      expect(out).toMatch(
        new RegExp(`<span class="gutter">${n}</span>`),
      );
    }
    // Source content escaped + present.
    for (const src of ['L3', 'L4', 'L5', 'L6', 'L7']) {
      expect(out).toContain(src);
    }
    // Focal line carries class `focal` and an inline background style.
    expect(out).toMatch(
      /<span class="line focal" style="background:[^"]+"><span class="gutter">5<\/span>/,
    );
    // Non-focal lines do not carry the focal class.
    expect(out).toMatch(
      /<span class="line"><span class="gutter">3<\/span>/,
    );
  });

  it('renders `(source file unavailable)` when a record has a line but no snippet entry', () => {
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [] },
      {
        left: new Map(),
        right: new Map([[added, [{ file: 'file:///cwd/foo.ttl', line: 5 }]]]),
      },
      new Map(),
      { cwd: '/cwd' },
    );

    expect(out).toContain('(source file unavailable)');
    expect(out).not.toContain('<pre class="snippet"');
  });

  it('renders `(source file unavailable)` for an explicit unavailable snippet result', () => {
    const added = triple('e', 'r', 'f');
    const snippets = new Map([
      [
        'file:///cwd/foo.ttl:5',
        { kind: 'unavailable' as const, reason: 'missing' as const },
      ],
    ]);
    const out = composeHtmlDiff(
      { added: [added], removed: [] },
      {
        left: new Map(),
        right: new Map([[added, [{ file: 'file:///cwd/foo.ttl', line: 5 }]]]),
      },
      snippets,
      { cwd: '/cwd' },
    );

    expect(out).toContain('(source file unavailable)');
    expect(out).not.toContain('<pre class="snippet"');
  });

  it('renders `(line not available)` for a record with no line — and never reads snippets for it', () => {
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [] },
      {
        left: new Map(),
        right: new Map([[added, [{ file: 'file:///cwd/foo.jsonld' }]]]),
      },
      new Map(),
      { cwd: '/cwd' },
    );

    expect(out).toContain('(line not available)');
    expect(out).not.toContain('<pre class="snippet"');
  });

  it('preserves record order across the cap: 10th appears before <details>, 11th appears inside', () => {
    const added = triple('e', 'r', 'f');
    const records = Array.from({ length: 12 }, (_, i) => ({
      file: 'file:///cwd/a.ttl',
      line: i + 1,
    }));
    const out = composeHtmlDiff(
      { added: [added], removed: [] },
      { left: new Map(), right: new Map([[added, records]]) },
      emptySnippets,
      { cwd: '/cwd' },
    );

    const detailsIdx = out.indexOf('<details');
    const closeDetailsIdx = out.indexOf('</details>');
    expect(detailsIdx).toBeGreaterThan(0);

    // First 10 (lines 1..10) appear before <details>.
    for (let i = 1; i <= 10; i++) {
      const idx = out.indexOf(`a.ttl:${i}`);
      expect(idx).toBeGreaterThan(0);
      expect(idx).toBeLessThan(detailsIdx);
    }
    // Overflow (lines 11, 12) appear inside <details>.
    for (const i of [11, 12]) {
      const idx = out.indexOf(`a.ttl:${i}`);
      expect(idx).toBeGreaterThan(detailsIdx);
      expect(idx).toBeLessThan(closeDetailsIdx);
    }
  });

  it('boundary: exactly 10 records render unchanged — no <details> wrapper', () => {
    const added = triple('e', 'r', 'f');
    const records = Array.from({ length: 10 }, (_, i) => ({
      file: 'file:///cwd/a.ttl',
      line: i + 1,
    }));
    const out = composeHtmlDiff(
      { added: [added], removed: [] },
      { left: new Map(), right: new Map([[added, records]]) },
      emptySnippets,
      { cwd: '/cwd' },
    );

    expect(out).not.toContain('<details');
    // All 10 records present.
    for (let i = 1; i <= 10; i++) {
      expect(out).toContain(`a.ttl:${i}`);
    }
  });

  it('caps inline records at 10 per hunk: with 11 records, exactly one <details> wraps the overflow (no <details> would appear at 10)', () => {
    const added = triple('e', 'r', 'f');
    const records = Array.from({ length: 11 }, (_, i) => ({
      file: 'file:///cwd/a.ttl',
      line: i + 1,
    }));
    const out = composeHtmlDiff(
      { added: [added], removed: [] },
      { left: new Map(), right: new Map([[added, records]]) },
      emptySnippets,
      { cwd: '/cwd' },
    );

    // Exactly one <details> opener for the overflow.
    expect(out.match(/<details\b/g) ?? []).toHaveLength(1);
    expect(out.match(/<\/details>/g) ?? []).toHaveLength(1);

    // No JavaScript introduced.
    expect(out).not.toContain('<script');
  });

  it('renders multiple records per hunk in input order', () => {
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [] },
      {
        left: new Map(),
        right: new Map([
          [
            added,
            [
              { file: 'file:///cwd/a.ttl', line: 5 },
              { file: 'file:///cwd/a.ttl', line: 12 },
              { file: 'file:///cwd/b.ttl', line: 3 },
            ],
          ],
        ]),
      },
      emptySnippets,
      { cwd: '/cwd' },
    );

    const i1 = out.indexOf('a.ttl:5');
    const i2 = out.indexOf('a.ttl:12');
    const i3 = out.indexOf('b.ttl:3');
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
  });
});
