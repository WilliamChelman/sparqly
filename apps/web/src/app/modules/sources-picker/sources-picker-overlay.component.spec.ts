import { TestBed } from '@angular/core/testing';
import type { SourceListingEntry } from '@app/core';
import { of, Subject, type Observable } from 'rxjs';
import { RefsApiClient, type RefsLoadResult, type RefsResponse } from './refs-api.client';
import { SourcesPickerOverlayComponent } from './sources-picker-overlay.component';

const TWO_SOURCES: SourceListingEntry[] = [
  { id: 'left', kind: 'glob', label: 'left (glob)' },
  { id: 'right', kind: 'glob', label: 'right (glob)' },
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
}

function stubRefsApi(
  responses: Partial<Record<string, RefsLoadResult>> = {},
): StubRefsApi {
  const calls: string[] = [];
  const client = {
    load(id: string): Observable<RefsLoadResult> {
      calls.push(id);
      const fallback: RefsLoadResult = { state: 'ok', refs: REFS_DEFAULT };
      return of(responses[id] ?? fallback);
    },
  } as unknown as RefsApiClient;
  return { client, calls };
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

  it('marks non-matching siblings of a matched child with data-dimmed (structural cue preserved)', () => {
    const grouped: SourceListingEntry[] = [
      { id: 'docs', kind: 'glob', label: 'docs (glob)' },
      {
        id: 'docs/alice.ttl',
        kind: 'file',
        label: 'alice.ttl',
        parentId: 'docs',
      },
      {
        id: 'docs/bob.ttl',
        kind: 'file',
        label: 'bob.ttl',
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
    const alice = root.querySelector(
      '[data-source-id="docs/alice.ttl"]',
    ) as HTMLElement;
    const bob = root.querySelector(
      '[data-source-id="docs/bob.ttl"]',
    ) as HTMLElement;
    expect(alice).toBeTruthy();
    expect(bob).toBeTruthy();
    expect(alice.getAttribute('data-dimmed')).toBeNull();
    expect(bob.getAttribute('data-dimmed')).toBe('true');
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
      } as unknown as RefsApiClient,
      calls: [],
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
