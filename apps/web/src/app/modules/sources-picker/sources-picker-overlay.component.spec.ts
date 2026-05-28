import { TestBed } from '@angular/core/testing';
import type { SourceListingEntry } from '@app/core';
import { of, Subject, type Observable } from 'rxjs';
import {
  RefsApiClient,
  type CommitsLoadResult,
  type CommitsResponse,
  type RefreshResult,
  type RefsLoadResult,
  type RefsResponse,
} from './refs-api.client';
import { SourcesPickerOverlayComponent } from './sources-picker-overlay.component';

const TWO_SOURCES: SourceListingEntry[] = [
  { id: 'left', kind: 'glob', mode: 'in-memory', label: 'left (glob)' },
  { id: 'right', kind: 'glob', mode: 'in-memory', label: 'right (glob)' },
];

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const REFS_DEFAULT: RefsResponse = {
  head: { ref: 'HEAD', sha: SHA_A, kind: 'head' },
  branches: [
    { ref: 'main', sha: SHA_A, kind: 'branch' },
    { ref: 'feat/x', sha: SHA_B, kind: 'branch' },
  ],
  remoteBranches: [],
  tags: [{ ref: 'v1.0.0', sha: SHA_B, kind: 'tag-annotated' }],
};

interface StubRefsApi {
  readonly client: RefsApiClient;
  readonly calls: string[];
  readonly refreshCalls: string[];
  readonly commitsCalls: Array<{ id: string; scope: string; before?: string }>;
}

const EMPTY_COMMITS: CommitsResponse = { commits: [], nextBefore: null };

function stubRefsApi(
  responses: Partial<Record<string, RefsLoadResult>> = {},
  refreshResponses: Partial<Record<string, RefreshResult>> = {},
  commitsResponses: Partial<Record<string, CommitsLoadResult>> = {},
  commitsByKey: Partial<Record<string, CommitsLoadResult>> = {},
): StubRefsApi {
  const calls: string[] = [];
  const refreshCalls: string[] = [];
  const commitsCalls: Array<{ id: string; scope: string; before?: string }> = [];
  const client = {
    load(id: string): Observable<RefsLoadResult> {
      calls.push(id);
      const fallback: RefsLoadResult = { state: 'ok', refs: REFS_DEFAULT };
      return of(responses[id] ?? fallback);
    },
    refresh(id: string): Observable<RefreshResult> {
      refreshCalls.push(id);
      const fallback: RefreshResult = { state: 'ok', refs: REFS_DEFAULT };
      return of(refreshResponses[id] ?? fallback);
    },
    loadCommits(
      id: string,
      options: { scope: string; before?: string },
    ): Observable<CommitsLoadResult> {
      commitsCalls.push({ id, scope: options.scope, before: options.before });
      const key = `${id}\x00${options.scope}\x00${options.before ?? ''}`;
      const keyed = commitsByKey[key];
      if (keyed !== undefined) return of(keyed);
      const fallback: CommitsLoadResult = {
        state: 'ok',
        commits: EMPTY_COMMITS,
      };
      return of(commitsResponses[id] ?? fallback);
    },
    clearCommitsCache(_id: string): void {
      /* no-op for the stub */
    },
  } as unknown as RefsApiClient;
  return { client, calls, refreshCalls, commitsCalls };
}

function mount(
  sources: SourceListingEntry[],
  initialSelectedId = '',
  refsApi: StubRefsApi = stubRefsApi(),
  extra: { initialRef?: string } = {},
) {
  TestBed.configureTestingModule({});
  TestBed.overrideComponent(SourcesPickerOverlayComponent, {
    set: { providers: [{ provide: RefsApiClient, useValue: refsApi.client }] },
  });
  const fixture = TestBed.createComponent(SourcesPickerOverlayComponent);
  fixture.componentRef.setInput('sources', sources);
  fixture.componentRef.setInput('initialSelectedId', initialSelectedId);
  if (extra.initialRef !== undefined) {
    fixture.componentRef.setInput('initialRef', extra.initialRef);
  }
  fixture.detectChanges();
  return { fixture, refsApi };
}

describe('SourcesPickerOverlayComponent', () => {
  it('renders one row per source entry passed in', () => {
    const { fixture } = mount(TWO_SOURCES);
    const root = fixture.nativeElement as HTMLElement;
    const ids = Array.from(root.querySelectorAll('[data-source-id]')).map(
      (el) => el.getAttribute('data-source-id'),
    );
    expect(ids).toEqual(['left', 'right']);
  });

  it('ArrowDown / ArrowUp moves the staged selection through the source list; Apply emits the navigated id', () => {
    const { fixture } = mount(TWO_SOURCES, 'left');
    const root = fixture.nativeElement as HTMLElement;
    const emitted: string[] = [];
    fixture.componentInstance.applied.subscribe((v: string) => emitted.push(v));
    const overlay = root.querySelector(
      '[data-testid="sources-overlay"]',
    ) as HTMLElement;
    overlay.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="overlay-apply"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(emitted).toEqual(['right']);
  });

  it('hides non-matching siblings while filtering and renders the parent as a non-clickable breadcrumb', () => {
    const grouped: SourceListingEntry[] = [
      { id: 'docs', kind: 'glob', mode: 'in-memory', label: 'docs' },
      {
        id: 'docs/alice.ttl',
        kind: 'file',
        mode: 'in-memory',
        label: 'docs/alice.ttl',
        parentId: 'docs',
      },
      {
        id: 'docs/bob.ttl',
        kind: 'file',
        mode: 'in-memory',
        label: 'docs/bob.ttl',
        parentId: 'docs',
      },
    ];
    const { fixture } = mount(grouped, 'docs');
    const root = fixture.nativeElement as HTMLElement;
    const search = root.querySelector(
      '[data-testid="overlay-search"]',
    ) as HTMLInputElement;
    search.value = 'alice';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const alice = root.querySelector('[data-source-id="docs/alice.ttl"]');
    const bob = root.querySelector('[data-source-id="docs/bob.ttl"]');
    expect(alice).toBeTruthy();
    expect(bob).toBeNull();
    // Parent "docs" no longer matches, so it's a breadcrumb (not selectable).
    expect(root.querySelector('[data-source-id="docs"]')).toBeNull();
    expect(root.querySelector('[data-source-breadcrumb="docs"]')).toBeTruthy();
  });

  it('renders child labels with the parent prefix stripped and indented under the group', () => {
    const grouped: SourceListingEntry[] = [
      { id: 'era-skos', kind: 'glob', mode: 'in-memory', label: 'era-skos' },
      {
        id: 'era-skos/Concepts.ttl',
        kind: 'file',
        mode: 'in-memory',
        label: 'era-skos/Concepts.ttl',
        parentId: 'era-skos',
      },
    ];
    const { fixture } = mount(grouped, 'era-skos/Concepts.ttl');
    const root = fixture.nativeElement as HTMLElement;
    const child = root.querySelector(
      '[data-source-id="era-skos/Concepts.ttl"]',
    ) as HTMLElement;
    expect(child).toBeTruthy();
    expect(child.getAttribute('data-depth')).toBe('1');
    expect(child.textContent?.trim()).toBe('Concepts.ttl');
  });

  it('shows a group child count when no query is active', () => {
    const grouped: SourceListingEntry[] = [
      { id: 'docs', kind: 'glob', mode: 'in-memory', label: 'docs' },
      {
        id: 'docs/a.ttl',
        kind: 'file',
        mode: 'in-memory',
        label: 'docs/a.ttl',
        parentId: 'docs',
      },
      {
        id: 'docs/b.ttl',
        kind: 'file',
        mode: 'in-memory',
        label: 'docs/b.ttl',
        parentId: 'docs',
      },
    ];
    const { fixture } = mount(grouped, 'docs');
    const root = fixture.nativeElement as HTMLElement;
    const count = root.querySelector(
      '[data-source-id="docs"] [data-testid="group-count"]',
    );
    expect(count?.textContent?.trim()).toBe('(2)');
  });

  it('shows a match-count badge while filtering', () => {
    const grouped: SourceListingEntry[] = [
      { id: 'docs', kind: 'glob', mode: 'in-memory', label: 'docs' },
      {
        id: 'docs/a.ttl',
        kind: 'file',
        mode: 'in-memory',
        label: 'docs/a.ttl',
        parentId: 'docs',
      },
      {
        id: 'docs/b.ttl',
        kind: 'file',
        mode: 'in-memory',
        label: 'docs/b.ttl',
        parentId: 'docs',
      },
    ];
    const { fixture } = mount(grouped, 'docs');
    const root = fixture.nativeElement as HTMLElement;
    const search = root.querySelector(
      '[data-testid="overlay-search"]',
    ) as HTMLInputElement;
    search.value = '.ttl';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const badge = root.querySelector('[data-testid="overlay-match-count"]');
    expect(badge?.textContent?.trim()).toBe('2 matches');
  });

  it('toggles a group via its chevron without selecting it', () => {
    const grouped: SourceListingEntry[] = [
      { id: 'docs', kind: 'glob', mode: 'in-memory', label: 'docs' },
      {
        id: 'docs/a.ttl',
        kind: 'file',
        mode: 'in-memory',
        label: 'docs/a.ttl',
        parentId: 'docs',
      },
    ];
    const { fixture } = mount(grouped, 'docs');
    const root = fixture.nativeElement as HTMLElement;
    // Collapsed by default: child not rendered.
    expect(root.querySelector('[data-source-id="docs/a.ttl"]')).toBeNull();
    const chevron = root.querySelector(
      '[data-source-group="docs"] [data-testid="group-chevron"]',
    ) as HTMLButtonElement;
    chevron.click();
    fixture.detectChanges();
    expect(root.querySelector('[data-source-id="docs/a.ttl"]')).toBeTruthy();
    // Re-click collapses.
    chevron.click();
    fixture.detectChanges();
    expect(root.querySelector('[data-source-id="docs/a.ttl"]')).toBeNull();
  });

  it('bolds the matched substring within the matching row', () => {
    const { fixture } = mount(TWO_SOURCES, 'right');
    const root = fixture.nativeElement as HTMLElement;
    const search = root.querySelector(
      '[data-testid="overlay-search"]',
    ) as HTMLInputElement;
    search.value = 'rig';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const row = root.querySelector(
      '[data-source-id="right"]',
    ) as HTMLElement;
    const mark = row.querySelector('mark, [data-testid="match-bold"], strong, b');
    expect(mark).toBeTruthy();
    expect(mark?.textContent?.toLowerCase()).toBe('rig');
  });

  it('renders an empty-state with a Clear search affordance when nothing matches; clicking Clear resets the query', () => {
    const { fixture } = mount(TWO_SOURCES, 'right');
    const root = fixture.nativeElement as HTMLElement;
    const search = root.querySelector(
      '[data-testid="overlay-search"]',
    ) as HTMLInputElement;
    search.value = 'zzzzz';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(root.querySelectorAll('[data-source-id]').length).toBe(0);
    const empty = root.querySelector('[data-testid="overlay-empty"]');
    expect(empty).toBeTruthy();
    const clear = root.querySelector(
      '[data-testid="overlay-clear-search"]',
    ) as HTMLButtonElement;
    expect(clear).toBeTruthy();
    clear.click();
    fixture.detectChanges();
    expect(
      (root.querySelector('[data-testid="overlay-search"]') as HTMLInputElement)
        .value,
    ).toBe('');
    expect(root.querySelectorAll('[data-source-id]').length).toBe(
      TWO_SOURCES.length,
    );
  });

  it('filters the source list as the user types in the search input', () => {
    const { fixture } = mount(TWO_SOURCES, 'right');
    const root = fixture.nativeElement as HTMLElement;
    const search = root.querySelector(
      '[data-testid="overlay-search"]',
    ) as HTMLInputElement;
    expect(search).toBeTruthy();
    search.value = 'lef';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const ids = Array.from(root.querySelectorAll('[data-source-id]')).map(
      (el) => el.getAttribute('data-source-id'),
    );
    expect(ids).toEqual(['left']);
  });

  it('renders the refs-panel populated with the focused source\'s refs', () => {
    const { fixture } = mount(TWO_SOURCES, 'right');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="refs-panel"]')).toBeTruthy();
    expect(root.querySelector('[data-ref="main"]')).toBeTruthy();
    expect(root.querySelector('[data-ref="v1.0.0"]')).toBeTruthy();
  });

  it('renders the no-git message when the API client returns state:no-git-repo', () => {
    const api = stubRefsApi({
      right: { state: 'no-git-repo', kind: 'endpoint' },
    });
    const { fixture } = mount(TWO_SOURCES, 'right', api);
    const root = fixture.nativeElement as HTMLElement;
    const msg = root.querySelector('[data-testid="refs-panel-no-git"]');
    expect(msg?.textContent ?? '').toContain('(endpoint)');
  });

  it('fetches refs again when the focused source row changes (passing the new id)', () => {
    const api = stubRefsApi();
    const { fixture } = mount(TWO_SOURCES, 'right', api);
    const root = fixture.nativeElement as HTMLElement;
    expect(api.calls).toEqual(['right']);
    (root.querySelector('[data-source-id="left"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(api.calls).toEqual(['right', 'left']);
  });

  it('clears any staged ref when the focused source row changes (refs are per-source)', () => {
    const { fixture } = mount(TWO_SOURCES, 'right');
    const root = fixture.nativeElement as HTMLElement;
    // Pick a ref on the right source.
    (root.querySelector('[data-ref="main"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(
      root
        .querySelector('[data-ref="main"]')
        ?.getAttribute('aria-selected'),
    ).toBe('true');
    // Switch focused source: staged ref should reset.
    (root.querySelector('[data-source-id="left"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(
      root.querySelector('[aria-selected="true"][data-ref]'),
    ).toBeNull();
  });

  it('Apply emits combined `@id:ref` when a ref is staged', () => {
    const { fixture } = mount(TWO_SOURCES, 'right');
    const root = fixture.nativeElement as HTMLElement;
    const emitted: string[] = [];
    fixture.componentInstance.applied.subscribe((v: string) => emitted.push(v));
    (root.querySelector('[data-ref="main"]') as HTMLElement).click();
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="overlay-apply"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(emitted).toEqual(['@right:main']);
  });

  it('Apply emits the bare source id when no ref is staged', () => {
    const { fixture } = mount(TWO_SOURCES, 'right');
    const root = fixture.nativeElement as HTMLElement;
    const emitted: string[] = [];
    fixture.componentInstance.applied.subscribe((v: string) => emitted.push(v));
    (
      root.querySelector('[data-testid="overlay-apply"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(emitted).toEqual(['right']);
  });

  it('opens with `initialRef` pre-selected in the refs panel', () => {
    const { fixture } = mount(TWO_SOURCES, 'right', stubRefsApi(), {
      initialRef: 'feat/x',
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(
      root
        .querySelector('[data-ref="feat/x"]')
        ?.getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('keeps an `initialRef` after Apply when the focused source is unchanged (emits `@id:ref`)', () => {
    const { fixture } = mount(TWO_SOURCES, 'right', stubRefsApi(), {
      initialRef: 'feat/x',
    });
    const root = fixture.nativeElement as HTMLElement;
    const emitted: string[] = [];
    fixture.componentInstance.applied.subscribe((v: string) => emitted.push(v));
    (
      root.querySelector('[data-testid="overlay-apply"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(emitted).toEqual(['@right:feat/x']);
  });

  it('uses a roving tabindex on the source list — only the staged row is tab-focusable', () => {
    const { fixture } = mount(TWO_SOURCES, 'right');
    const root = fixture.nativeElement as HTMLElement;
    const left = root.querySelector('[data-source-id="left"]') as HTMLElement;
    const right = root.querySelector('[data-source-id="right"]') as HTMLElement;
    expect(right.getAttribute('tabindex')).toBe('0');
    expect(left.getAttribute('tabindex')).toBe('-1');
  });

  it('uses a roving tabindex on the refs list — only the staged ref row is tab-focusable', () => {
    const { fixture } = mount(TWO_SOURCES, 'right', stubRefsApi(), {
      initialRef: 'main',
    });
    const root = fixture.nativeElement as HTMLElement;
    const main = root.querySelector('[data-ref="main"]') as HTMLElement;
    const tag = root.querySelector('[data-ref="v1.0.0"]') as HTMLElement;
    expect(main.getAttribute('tabindex')).toBe('0');
    expect(tag.getAttribute('tabindex')).toBe('-1');
  });

  it('arrow keys on the refs panel move the staged ref through the rendered ref order (alphabetical when no search query)', () => {
    // flatRefs (empty query → alphabetical within section): HEAD, feat/x, main, v1.0.0
    const { fixture } = mount(TWO_SOURCES, 'right', stubRefsApi(), {
      initialRef: 'feat/x',
    });
    const root = fixture.nativeElement as HTMLElement;
    const panel = root.querySelector('[data-testid="refs-panel"]') as HTMLElement;
    panel.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.stagedRef()).toBe('main');
    panel.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.stagedRef()).toBe('v1.0.0');
    panel.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.stagedRef()).toBe('main');
  });

  it('lazily loads refs only on focus — late-arriving refs do not block the panel from rendering', async () => {
    const subj = new Subject<RefsLoadResult>();
    const lateApi: StubRefsApi = {
      client: {
        load(_id: string) {
          return subj.asObservable();
        },
        loadCommits(_id: string, _opts: { scope: string }) {
          return of<CommitsLoadResult>({ state: 'ok', commits: EMPTY_COMMITS });
        },
        clearCommitsCache(_id: string): void {
          /* no-op */
        },
      } as unknown as RefsApiClient,
      calls: [],
      refreshCalls: [],
      commitsCalls: [],
    };
    const { fixture } = mount(TWO_SOURCES, 'right', lateApi);
    const root = fixture.nativeElement as HTMLElement;
    // Pre-resolution: panel should not yet show ref rows.
    expect(root.querySelector('[data-ref]')).toBeNull();
    subj.next({ state: 'ok', refs: REFS_DEFAULT });
    fixture.detectChanges();
    expect(root.querySelector('[data-ref="main"]')).toBeTruthy();
  });

  it('treats Escape as a cancel signal', () => {
    const { fixture } = mount(TWO_SOURCES, 'right');
    const root = fixture.nativeElement as HTMLElement;
    const cancelEmits: number[] = [];
    const appliedEmits: string[] = [];
    fixture.componentInstance.canceled.subscribe(() => cancelEmits.push(1));
    fixture.componentInstance.applied.subscribe((v: string) =>
      appliedEmits.push(v),
    );
    const overlay = root.querySelector(
      '[data-testid="sources-overlay"]',
    ) as HTMLElement;
    expect(overlay).toBeTruthy();
    overlay.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(cancelEmits).toEqual([1]);
    expect(appliedEmits).toEqual([]);
  });

  it('emits canceled (and not applied) when the Cancel button is clicked, even after a row has been staged', () => {
    const { fixture } = mount(TWO_SOURCES, 'right');
    const root = fixture.nativeElement as HTMLElement;
    const appliedEmits: string[] = [];
    const cancelEmits: number[] = [];
    fixture.componentInstance.applied.subscribe((v: string) =>
      appliedEmits.push(v),
    );
    fixture.componentInstance.canceled.subscribe(() =>
      cancelEmits.push(cancelEmits.length + 1),
    );
    (root.querySelector('[data-source-id="left"]') as HTMLElement).click();
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="overlay-cancel"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(appliedEmits).toEqual([]);
    expect(cancelEmits).toEqual([1]);
  });

  it('stages a different selection when a row is clicked, and Apply emits the staged id', () => {
    const { fixture } = mount(TWO_SOURCES, 'right');
    const root = fixture.nativeElement as HTMLElement;
    const emitted: string[] = [];
    fixture.componentInstance.applied.subscribe((v: string) => emitted.push(v));
    (
      root.querySelector('[data-source-id="left"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="overlay-apply"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(emitted).toEqual(['left']);
  });

  it('Enter in the refs search with a typed value and no focused row applies the typed string verbatim as the ref', () => {
    const { fixture } = mount(TWO_SOURCES, 'right');
    const root = fixture.nativeElement as HTMLElement;
    const emitted: string[] = [];
    fixture.componentInstance.applied.subscribe((v: string) => emitted.push(v));
    const search = root.querySelector(
      '[data-testid="refs-search"]',
    ) as HTMLInputElement;
    search.value = 'HEAD~3';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    search.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    fixture.detectChanges();
    expect(emitted).toEqual(['@right:HEAD~3']);
  });

  it('clicking a different source row clears the ref-search input (refs are per-source)', () => {
    const { fixture } = mount(TWO_SOURCES, 'right');
    const root = fixture.nativeElement as HTMLElement;
    const search = () =>
      root.querySelector('[data-testid="refs-search"]') as HTMLInputElement;
    search().value = 'feat';
    search().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(search().value).toBe('feat');
    (root.querySelector('[data-source-id="left"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(search().value).toBe('');
  });

  it('clicking ⟳ Refresh remotes calls refresh() with the focused source id and replaces the ref list with the fresh response', () => {
    const fresh: RefsResponse = {
      head: { ref: 'HEAD', sha: SHA_B, kind: 'head' },
      branches: [{ ref: 'release', sha: SHA_B, kind: 'branch' }],
      remoteBranches: [],
      tags: [],
    };
    const api = stubRefsApi({}, { right: { state: 'ok', refs: fresh } });
    const { fixture } = mount(TWO_SOURCES, 'right', api);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-ref="main"]')).toBeTruthy();
    (root.querySelector('[data-testid="refs-refresh"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(api.refreshCalls).toEqual(['right']);
    expect(root.querySelector('[data-ref="main"]')).toBeNull();
    expect(root.querySelector('[data-ref="release"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="refs-refresh-error"]')).toBeNull();
  });

  it('clicking ⟳ Refresh remotes on a fetch-failed response renders the failure class inline and preserves the previously-rendered ref list', () => {
    const api = stubRefsApi(
      {},
      { right: { state: 'fetch-failed', kind: 'network' } },
    );
    const { fixture } = mount(TWO_SOURCES, 'right', api);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-ref="main"]')).toBeTruthy();
    (root.querySelector('[data-testid="refs-refresh"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const errEl = root.querySelector('[data-testid="refs-refresh-error"]');
    expect(errEl).toBeTruthy();
    expect((errEl?.textContent ?? '').toLowerCase()).toContain('network');
    // List preserved.
    expect(root.querySelector('[data-ref="main"]')).toBeTruthy();
    expect(root.querySelector('[data-ref="feat/x"]')).toBeTruthy();
  });

  describe('Commits section · pagination (Show more)', () => {
    const SHA_PAGE1_LAST = 'a'.repeat(40);
    const SHA_PAGE1_FIRST = '1'.repeat(40);
    const SHA_PAGE2_LAST = '2'.repeat(40);
    const PAGE1: CommitsResponse = {
      commits: [
        {
          sha: SHA_PAGE1_FIRST,
          shortSha: SHA_PAGE1_FIRST.slice(0, 7),
          subject: 'one',
          authorName: 'A',
          authorDate: '2026-05-25T10:00:00Z',
          parents: [],
        },
        {
          sha: SHA_PAGE1_LAST,
          shortSha: SHA_PAGE1_LAST.slice(0, 7),
          subject: 'two',
          authorName: 'A',
          authorDate: '2026-05-24T10:00:00Z',
          parents: [],
        },
      ],
      nextBefore: SHA_PAGE1_LAST,
    };
    const PAGE2: CommitsResponse = {
      commits: [
        {
          sha: SHA_PAGE2_LAST,
          shortSha: SHA_PAGE2_LAST.slice(0, 7),
          subject: 'three',
          authorName: 'A',
          authorDate: '2026-05-23T10:00:00Z',
          parents: [],
        },
      ],
      nextBefore: null,
    };

    it('clicking Show more calls loadCommits with before=nextBefore and appends the new page to the rendered list', () => {
      const api = stubRefsApi(
        {},
        {},
        { right: { state: 'ok', commits: PAGE1 } },
        {
          [`right\x00HEAD\x00${SHA_PAGE1_LAST}`]: {
            state: 'ok',
            commits: PAGE2,
          },
        },
      );
      const { fixture } = mount(TWO_SOURCES, 'right', api);
      const root = fixture.nativeElement as HTMLElement;
      // Initial fetch with no `before`
      expect(api.commitsCalls).toEqual([
        { id: 'right', scope: 'HEAD', before: undefined },
      ]);
      // Page 1 rendered
      expect(
        Array.from(root.querySelectorAll('[data-commit-sha]')).map((el) =>
          el.getAttribute('data-commit-sha'),
        ),
      ).toEqual([SHA_PAGE1_FIRST, SHA_PAGE1_LAST]);

      const showMore = root.querySelector(
        '[data-testid="commits-show-more"]',
      ) as HTMLButtonElement;
      expect(showMore).toBeTruthy();
      showMore.click();
      fixture.detectChanges();

      expect(api.commitsCalls).toEqual([
        { id: 'right', scope: 'HEAD', before: undefined },
        { id: 'right', scope: 'HEAD', before: SHA_PAGE1_LAST },
      ]);
      // Both pages now rendered, in order
      expect(
        Array.from(root.querySelectorAll('[data-commit-sha]')).map((el) =>
          el.getAttribute('data-commit-sha'),
        ),
      ).toEqual([SHA_PAGE1_FIRST, SHA_PAGE1_LAST, SHA_PAGE2_LAST]);
      // Show more is hidden (page 2 has nextBefore = null)
      expect(
        root.querySelector('[data-testid="commits-show-more"]'),
      ).toBeNull();
    });

    it('changing the scope resets the cursor — the first fetch under the new scope carries no `before`', () => {
      const api = stubRefsApi(
        {},
        {},
        { right: { state: 'ok', commits: PAGE1 } },
        {
          [`right\x00HEAD\x00${SHA_PAGE1_LAST}`]: {
            state: 'ok',
            commits: PAGE2,
          },
        },
      );
      const { fixture } = mount(TWO_SOURCES, 'right', api);
      const root = fixture.nativeElement as HTMLElement;
      // Page page 2 first
      (
        root.querySelector(
          '[data-testid="commits-show-more"]',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      // Now switch scope to __all__
      const scopeSelect = root.querySelector(
        '[data-testid="commits-scope-select"]',
      ) as HTMLSelectElement;
      scopeSelect.value = '__all__';
      scopeSelect.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      // The first call under __all__ scope carries no `before`
      const allCalls = api.commitsCalls.filter((c) => c.scope === '__all__');
      expect(allCalls.length).toBeGreaterThan(0);
      expect(allCalls[0].before).toBeUndefined();
    });

    it('re-opening a previously paginated scope renders accumulated pages from cache without re-fetching', () => {
      const api = stubRefsApi(
        {},
        {},
        { right: { state: 'ok', commits: PAGE1 } },
        {
          [`right\x00HEAD\x00${SHA_PAGE1_LAST}`]: {
            state: 'ok',
            commits: PAGE2,
          },
          [`right\x00main\x00`]: {
            state: 'ok',
            commits: { commits: [], nextBefore: null },
          },
        },
      );
      const { fixture } = mount(TWO_SOURCES, 'right', api);
      const root = fixture.nativeElement as HTMLElement;
      // Paginate to page 2
      (
        root.querySelector(
          '[data-testid="commits-show-more"]',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      const scopeSelect = root.querySelector(
        '[data-testid="commits-scope-select"]',
      ) as HTMLSelectElement;
      // Switch away
      scopeSelect.value = 'main';
      scopeSelect.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      const callsAfterAway = api.commitsCalls.length;

      // Switch back to HEAD
      scopeSelect.value = 'HEAD';
      scopeSelect.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      // No new HTTP calls were made on re-entry to HEAD
      expect(api.commitsCalls.length).toBe(callsAfterAway);
      // Both accumulated pages still render
      expect(
        Array.from(root.querySelectorAll('[data-commit-sha]')).map((el) =>
          el.getAttribute('data-commit-sha'),
        ),
      ).toEqual([SHA_PAGE1_FIRST, SHA_PAGE1_LAST, SHA_PAGE2_LAST]);
    });
  });

  it('emits applied with the initial selection when Apply is clicked without picking another row', () => {
    const { fixture } = mount(TWO_SOURCES, 'right');
    const root = fixture.nativeElement as HTMLElement;
    const emitted: string[] = [];
    fixture.componentInstance.applied.subscribe((v: string) => emitted.push(v));
    const apply = root.querySelector(
      '[data-testid="overlay-apply"]',
    ) as HTMLButtonElement;
    expect(apply).toBeTruthy();
    apply.click();
    fixture.detectChanges();
    expect(emitted).toEqual(['right']);
  });
});
