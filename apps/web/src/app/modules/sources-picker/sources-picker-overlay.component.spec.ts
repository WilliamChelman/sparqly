import { TestBed } from '@angular/core/testing';
import type { SourceListingEntry } from '@app/core';
import { SourcesPickerOverlayComponent } from './sources-picker-overlay.component';

const TWO_SOURCES: SourceListingEntry[] = [
  { id: 'left', kind: 'glob', label: 'left (glob)' },
  { id: 'right', kind: 'glob', label: 'right (glob)' },
];

function mount(sources: SourceListingEntry[], initialSelectedId = '') {
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(SourcesPickerOverlayComponent);
  fixture.componentRef.setInput('sources', sources);
  fixture.componentRef.setInput('initialSelectedId', initialSelectedId);
  fixture.detectChanges();
  return { fixture };
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

  it('renders a placeholder in the right column until the refs panel is implemented', () => {
    const { fixture } = mount(TWO_SOURCES, 'right');
    const root = fixture.nativeElement as HTMLElement;
    const stub = root.querySelector('[data-testid="refs-panel-stub"]');
    expect(stub).toBeTruthy();
    expect(stub?.textContent?.toLowerCase()).toContain('refs panel coming soon');
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
