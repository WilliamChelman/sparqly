import { describe, expect, it } from 'vitest';
import type { Hunk, HunkedRdfDiff } from './group-rdf-diff-by-entity';
import { composeHtmlDiff } from './html-diff-composer';

const emptySnippets = new Map();

const emptyHunked: HunkedRdfDiff = {
  changed: [],
  removed: [],
  added: [],
  totals: { left: 0, right: 0 },
};

const EX = 'http://example.org/';
const SH = 'http://www.w3.org/ns/shacl#';

function changedHunk(over: Partial<Hunk> = {}): Hunk {
  return {
    anchor: `${EX}Foo`,
    rdfType: `${SH}NodeShape`,
    state: 'changed',
    removed: 1,
    added: 1,
    lines: [
      {
        side: '-',
        subjectPath: `${EX}Foo`,
        predicate: `${EX}p`,
        object: `"old"`,
        nquad: `<${EX}Foo> <${EX}p> "old" .`,
      },
      {
        side: '+',
        subjectPath: `${EX}Foo`,
        predicate: `${EX}p`,
        object: `"new"`,
        nquad: `<${EX}Foo> <${EX}p> "new" .`,
      },
    ],
    sourceRecords: { left: [], right: [] },
    ...over,
  };
}

const PREFIXES = { ex: EX, sh: SH };

describe('composeHtmlDiff', () => {
  it('emits a self-contained HTML5 shell with summary and three (Changed/Removed/Added) sections in display order on empty input', () => {
    const out = composeHtmlDiff(emptyHunked, emptySnippets, {
      cwd: '/cwd',
      prefixes: {},
    });

    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toMatch(/<html\b/);
    expect(out).toMatch(/<\/html>\s*$/);
    expect(out).toContain('<style>');
    expect(out).not.toContain('<script');
    expect(out).not.toMatch(/<link\b/);

    // Summary contract preserved.
    expect(out).toMatch(/<p class="summary">left=0 right=0 \+0 −0<\/p>/);

    // Three sections in display order: Changed, Removed, Added.
    const changedIdx = out.indexOf('>Changed<');
    const removedIdx = out.indexOf('>Removed<');
    const addedIdx = out.indexOf('>Added<');
    expect(changedIdx).toBeGreaterThan(0);
    expect(removedIdx).toBeGreaterThan(changedIdx);
    expect(addedIdx).toBeGreaterThan(removedIdx);
  });

  it('renders the hunk header line one as `<anchor-CURIE>  (<rdf:type CURIE>)  [-N +M]`', () => {
    const hunk = changedHunk({ removed: 2, added: 3 });
    const out = composeHtmlDiff(
      { changed: [hunk], removed: [], added: [], totals: { left: 5, right: 6 } },
      emptySnippets,
      { cwd: '/cwd', prefixes: PREFIXES },
    );

    expect(out).toMatch(
      /<header class="hunk-header">\s*<div class="hunk-title">ex:Foo\s+\(sh:NodeShape\)\s+\[-2 \+3\]<\/div>/,
    );
  });

  it('renders `(removed)` / `(added)` markers in the header for single-side hunks (matches grouped formatter)', () => {
    const removedHunk = changedHunk({ state: 'removed', removed: 2, added: 0 });
    const addedHunk = changedHunk({
      anchor: `${EX}Bar`,
      state: 'added',
      removed: 0,
      added: 2,
    });
    const out = composeHtmlDiff(
      {
        changed: [],
        removed: [removedHunk],
        added: [addedHunk],
        totals: { left: 2, right: 2 },
      },
      emptySnippets,
      { cwd: '/cwd', prefixes: PREFIXES },
    );

    expect(out).toMatch(/ex:Foo\s+\(sh:NodeShape\)\s+\(removed\)\s+\[-2 \+0\]/);
    expect(out).toMatch(/ex:Bar\s+\(sh:NodeShape\)\s+\(added\)\s+\[-0 \+2\]/);
  });

  it('renders `(orphan)` marker and `_:`-prefixed anchor for orphan hunks', () => {
    const orphan: Hunk = {
      anchor: '_:c14n0',
      state: 'removed',
      orphan: true,
      removed: 2,
      added: 0,
      lines: [],
      sourceRecords: { left: [], right: [] },
    };
    const out = composeHtmlDiff(
      { changed: [], removed: [orphan], added: [], totals: { left: 2, right: 0 } },
      emptySnippets,
      { cwd: '/cwd', prefixes: PREFIXES },
    );
    expect(out).toMatch(/_:c14n0\s+\(orphan\)\s+\(removed\)\s+\[-2 \+0\]/);
  });

  it('renders the chip row of (file,line) refs in the header — left chips tinted red, right chips tinted green', () => {
    const hunk = changedHunk({
      sourceRecords: {
        left: [
          { file: 'file:///cwd/a.ttl', line: 7 },
          { file: 'file:///cwd/a.ttl', line: 12 },
        ],
        right: [{ file: 'file:///cwd/b.ttl', line: 3 }],
      },
    });
    const out = composeHtmlDiff(
      { changed: [hunk], removed: [], added: [], totals: { left: 1, right: 1 } },
      emptySnippets,
      { cwd: '/cwd', prefixes: PREFIXES },
    );

    // Chip row container exists.
    expect(out).toMatch(/<div class="hunk-chips">/);
    // Left-side chips carry `chip-left`, jump-link to the in-document snippet anchor.
    expect(out).toMatch(
      /<a class="chip chip-left" href="#a\.ttl-L7">a\.ttl:7<\/a>/,
    );
    expect(out).toMatch(
      /<a class="chip chip-left" href="#a\.ttl-L12">a\.ttl:12<\/a>/,
    );
    expect(out).toMatch(
      /<a class="chip chip-right" href="#b\.ttl-L3">b\.ttl:3<\/a>/,
    );
    // Side-tint CSS rules exist (red for left, green for right).
    expect(out).toMatch(/\.chip-left\{[^}]*background:#fee/);
    expect(out).toMatch(/\.chip-right\{[^}]*background:#efe/);
  });

  it('omits the chip row entirely when a hunk has no source records on either side', () => {
    const hunk = changedHunk();
    const out = composeHtmlDiff(
      { changed: [hunk], removed: [], added: [], totals: { left: 1, right: 1 } },
      emptySnippets,
      { cwd: '/cwd', prefixes: PREFIXES },
    );
    expect(out).not.toMatch(/<div class="hunk-chips"/);
  });

  it('renders the body as ordered -/+ lines, with paired (subject-path, predicate) clusters adjacent', () => {
    const hunk = changedHunk({
      lines: [
        {
          side: '-',
          subjectPath: `${EX}Foo`,
          predicate: `${EX}p`,
          object: `"old"`,
          nquad: `<${EX}Foo> <${EX}p> "old" .`,
        },
        {
          side: '+',
          subjectPath: `${EX}Foo`,
          predicate: `${EX}p`,
          object: `"new"`,
          nquad: `<${EX}Foo> <${EX}p> "new" .`,
        },
      ],
    });
    const out = composeHtmlDiff(
      { changed: [hunk], removed: [], added: [], totals: { left: 1, right: 1 } },
      emptySnippets,
      { cwd: '/cwd', prefixes: PREFIXES },
    );

    // Body container exists.
    expect(out).toMatch(/<div class="hunk-body">/);
    // Each line carries its side class; subject is elided (anchor matches subjectPath).
    expect(out).toMatch(
      /<div class="line line-removed">.*?-<\/span>[^<]*<span class="text">ex:p &quot;old&quot; \./,
    );
    expect(out).toMatch(
      /<div class="line line-added">.*?\+<\/span>[^<]*<span class="text">ex:p &quot;new&quot; \./,
    );
    // Paired lines wrapped in a `<div class="pair">` so adjacency is visually emphasized.
    expect(out).toMatch(
      /<div class="pair">\s*<div class="line line-removed">[\s\S]*?<\/div>\s*<div class="line line-added">[\s\S]*?<\/div>\s*<\/div>/,
    );
  });

  it('emits unpaired lines outside the pair wrapper', () => {
    const hunk = changedHunk({
      removed: 0,
      added: 1,
      lines: [
        {
          side: '+',
          subjectPath: `${EX}Foo`,
          predicate: `${EX}q`,
          object: `<${EX}x>`,
          nquad: `<${EX}Foo> <${EX}q> <${EX}x> .`,
        },
      ],
    });
    const out = composeHtmlDiff(
      { changed: [hunk], removed: [], added: [], totals: { left: 0, right: 1 } },
      emptySnippets,
      { cwd: '/cwd', prefixes: PREFIXES },
    );
    expect(out).not.toMatch(/<div class="pair">/);
    expect(out).toMatch(/<div class="line line-added">/);
  });

  it('renders a snippet block per unique (file,line) per hunk with id `<basename>-L<line>`, and dedupes duplicate records', () => {
    const hunk = changedHunk({
      sourceRecords: {
        left: [
          { file: 'file:///cwd/a.ttl', line: 7 },
          { file: 'file:///cwd/a.ttl', line: 7 }, // duplicate — must not produce a second snippet
        ],
        right: [{ file: 'file:///cwd/b.ttl', line: 3 }],
      },
    });
    const snippets = new Map([
      [
        'file:///cwd/a.ttl:7',
        {
          kind: 'snippet' as const,
          startLine: 6,
          focalStart: 7,
          focalEnd: 7,
          lines: ['L6', 'L7', 'L8'],
        },
      ],
      [
        'file:///cwd/b.ttl:3',
        {
          kind: 'snippet' as const,
          startLine: 2,
          focalStart: 3,
          focalEnd: 3,
          lines: ['L2', 'L3', 'L4'],
        },
      ],
    ]);
    const out = composeHtmlDiff(
      { changed: [hunk], removed: [], added: [], totals: { left: 1, right: 1 } },
      snippets,
      { cwd: '/cwd', prefixes: PREFIXES },
    );

    // Exactly two snippet `<pre>` blocks (a.ttl:7 dedup'd).
    const matches = out.match(/<pre class="snippet"/g) ?? [];
    expect(matches).toHaveLength(2);
    // Snippet anchors carry the per-(file,line) id the chip links to.
    expect(out).toContain(' id="a.ttl-L7"');
    expect(out).toContain(' id="b.ttl-L3"');
    // Source content present (escaped — none of these need escaping).
    expect(out).toContain('L7');
    expect(out).toContain('L3');
  });

  it('renders `(source file unavailable)` for an explicit unavailable snippet result', () => {
    const hunk = changedHunk({
      sourceRecords: {
        left: [{ file: 'file:///cwd/a.ttl', line: 5 }],
        right: [],
      },
    });
    const snippets = new Map([
      [
        'file:///cwd/a.ttl:5',
        { kind: 'unavailable' as const, reason: 'missing' as const },
      ],
    ]);
    const out = composeHtmlDiff(
      { changed: [hunk], removed: [], added: [], totals: { left: 1, right: 1 } },
      snippets,
      { cwd: '/cwd', prefixes: PREFIXES },
    );

    expect(out).toContain('(source file unavailable)');
    expect(out).not.toContain('<pre class="snippet"');
  });

  it('emits no snippet block for records without a line number', () => {
    const hunk = changedHunk({
      sourceRecords: {
        left: [],
        right: [{ file: 'file:///cwd/foo.jsonld' }],
      },
    });
    const out = composeHtmlDiff(
      { changed: [hunk], removed: [], added: [], totals: { left: 1, right: 1 } },
      emptySnippets,
      { cwd: '/cwd', prefixes: PREFIXES },
    );
    expect(out).not.toContain('<pre class="snippet"');
  });

  it('boundary: a hunk with exactly 20 changed lines does NOT collapse the body', () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({
      side: i % 2 === 0 ? ('-' as const) : ('+' as const),
      subjectPath: `${EX}Foo`,
      predicate: `${EX}p${i}`,
      object: `"${i}"`,
      nquad: `<${EX}Foo> <${EX}p${i}> "${i}" .`,
    }));
    const hunk = changedHunk({ removed: 10, added: 10, lines });
    const out = composeHtmlDiff(
      { changed: [hunk], removed: [], added: [], totals: { left: 10, right: 10 } },
      emptySnippets,
      { cwd: '/cwd', prefixes: PREFIXES },
    );
    expect(out).not.toMatch(/<details class="hunk-overflow">/);
    // Header still visible.
    expect(out).toMatch(/ex:Foo\s+\(sh:NodeShape\)\s+\[-10 \+10\]/);
  });

  it('overflow: a hunk with more than 20 changed lines collapses the body in <details>; header stays visible', () => {
    const lines = Array.from({ length: 21 }, (_, i) => ({
      side: i % 2 === 0 ? ('-' as const) : ('+' as const),
      subjectPath: `${EX}Foo`,
      predicate: `${EX}p${i}`,
      object: `"${i}"`,
      nquad: `<${EX}Foo> <${EX}p${i}> "${i}" .`,
    }));
    const hunk = changedHunk({ removed: 11, added: 10, lines });
    const out = composeHtmlDiff(
      { changed: [hunk], removed: [], added: [], totals: { left: 11, right: 10 } },
      emptySnippets,
      { cwd: '/cwd', prefixes: PREFIXES },
    );

    // Header (anchor, type, counts) still visible OUTSIDE the <details>.
    const detailsOpen = out.indexOf('<details class="hunk-overflow"');
    expect(detailsOpen).toBeGreaterThan(0);
    const titleIdx = out.indexOf('ex:Foo');
    expect(titleIdx).toBeGreaterThan(0);
    expect(titleIdx).toBeLessThan(detailsOpen);

    // <details> summary: "Show N more" where N is the full overflowed line count.
    expect(out).toMatch(/<summary>Show 21 more<\/summary>/);

    // The body lines render INSIDE the <details>.
    const detailsClose = out.indexOf('</details>', detailsOpen);
    const inside = out.slice(detailsOpen, detailsClose);
    expect(inside).toMatch(/<div class="hunk-body">/);
  });

  it('renders hunks across all three sections in display order: Changed → Removed → Added', () => {
    const ch = changedHunk({ anchor: `${EX}Foo` });
    const rm: Hunk = {
      anchor: `${EX}Bar`,
      rdfType: `${SH}NodeShape`,
      state: 'removed',
      removed: 2,
      added: 0,
      lines: [],
      sourceRecords: { left: [], right: [] },
    };
    const ad: Hunk = {
      anchor: `${EX}Baz`,
      rdfType: `${SH}NodeShape`,
      state: 'added',
      removed: 0,
      added: 2,
      lines: [],
      sourceRecords: { left: [], right: [] },
    };
    const out = composeHtmlDiff(
      { changed: [ch], removed: [rm], added: [ad], totals: { left: 4, right: 4 } },
      emptySnippets,
      { cwd: '/cwd', prefixes: PREFIXES },
    );

    const fooIdx = out.indexOf('ex:Foo');
    const barIdx = out.indexOf('ex:Bar');
    const bazIdx = out.indexOf('ex:Baz');
    expect(fooIdx).toBeGreaterThan(0);
    expect(barIdx).toBeGreaterThan(fooIdx);
    expect(bazIdx).toBeGreaterThan(barIdx);
  });

  it('omits the rdf:type slot when the anchor has no rdf:type', () => {
    const hunk = changedHunk({ rdfType: undefined });
    const out = composeHtmlDiff(
      { changed: [hunk], removed: [], added: [], totals: { left: 1, right: 1 } },
      emptySnippets,
      { cwd: '/cwd', prefixes: PREFIXES },
    );

    expect(out).toMatch(/ex:Foo\s+\[-1 \+1\]/);
    expect(out).not.toContain('()');
  });
});
