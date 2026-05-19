import { TestBed } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { LibraryComboboxComponent } from './library-combobox.component';
import type { SavedQuerySummary } from '@app/core';

function setup(
  entries: readonly SavedQuerySummary[],
  options: { selectedSlug?: string | null } = {},
) {
  TestBed.configureTestingModule({ imports: [LibraryComboboxComponent] });
  const fixture = TestBed.createComponent(LibraryComboboxComponent);
  fixture.componentRef.setInput('entries', entries);
  if (options.selectedSlug !== undefined)
    fixture.componentRef.setInput('selectedSlug', options.selectedSlug);
  fixture.detectChanges();
  const overlayContainer =
    TestBed.inject(OverlayContainer).getContainerElement();
  return {
    fixture,
    root: fixture.nativeElement as HTMLElement,
    overlayContainer,
    component: fixture.componentInstance,
  };
}

function trigger(root: HTMLElement): HTMLButtonElement {
  return root.querySelector(
    '[data-testid="library-combobox-trigger"]',
  ) as HTMLButtonElement;
}

function entryRows(overlayContainer: HTMLElement): HTMLElement[] {
  return Array.from(
    overlayContainer.querySelectorAll<HTMLElement>(
      '[data-testid="library-combobox-entry"]',
    ),
  );
}

describe('LibraryComboboxComponent', () => {
  afterEach(() => {
    const container = TestBed.inject(OverlayContainer);
    container.ngOnDestroy();
  });

  it('opens on trigger click and emits load with the slug when an entry is clicked', () => {
    const { fixture, root, overlayContainer, component } = setup([
      { slug: 'alpha', hasParameters: false },
      { slug: 'beta', hasParameters: false },
    ]);
    const emitted: string[] = [];
    component.load.subscribe((slug: string) => emitted.push(slug));
    expect(entryRows(overlayContainer).length).toBe(0);
    trigger(root).click();
    fixture.detectChanges();
    const rows = entryRows(overlayContainer);
    expect(rows.map((n) => n.textContent?.trim() ?? '')).toEqual([
      'alpha',
      'beta',
    ]);
    rows[1].click();
    fixture.detectChanges();
    expect(emitted).toEqual(['beta']);
  });

  it('labels the trigger with the selected slug when one is supplied', () => {
    const { root } = setup([{ slug: 'alpha', hasParameters: false }], {
      selectedSlug: 'alpha',
    });
    expect(trigger(root).textContent).toContain('alpha');
  });

  it('labels the trigger with a load placeholder when no slug is selected', () => {
    const { root } = setup([{ slug: 'alpha', hasParameters: false }], {
      selectedSlug: null,
    });
    expect(trigger(root).textContent?.toLowerCase()).toContain('load');
  });

  it('narrows the visible entries client-side as the user types in the filter input', () => {
    const { fixture, root, overlayContainer } = setup([
      { slug: 'alpha', hasParameters: false },
      { slug: 'algebra', hasParameters: false },
      { slug: 'zeta', hasParameters: false },
    ]);
    trigger(root).click();
    fixture.detectChanges();
    const filter = overlayContainer.querySelector(
      '[data-testid="library-combobox-filter"]',
    ) as HTMLInputElement;
    filter.value = 'al';
    filter.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(
      entryRows(overlayContainer).map((n) => n.textContent?.trim() ?? ''),
    ).toEqual(['algebra', 'alpha']);
  });
});
