import { TestBed } from '@angular/core/testing';
import { LibraryPickerComponent } from './library-picker.component';
import type { SavedQuerySummary } from '@app/core';

function setup(entries: readonly SavedQuerySummary[]) {
  TestBed.configureTestingModule({ imports: [LibraryPickerComponent] });
  const fixture = TestBed.createComponent(LibraryPickerComponent);
  fixture.componentRef.setInput('entries', entries);
  fixture.detectChanges();
  return {
    fixture,
    root: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance,
  };
}

describe('LibraryPickerComponent', () => {
  function visibleSlugs(root: HTMLElement): string[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>('[data-testid="library-entry-slug"]'),
    ).map((n) => n.textContent?.trim() ?? '');
  }

  it('renders one row per saved entry, alphabetically by slug', () => {
    const { root } = setup([
      { slug: 'zeta', hasParameters: false },
      { slug: 'alpha', hasParameters: false },
      { slug: 'mu', hasParameters: false },
    ]);
    expect(visibleSlugs(root)).toEqual(['alpha', 'mu', 'zeta']);
  });

  it('narrows the visible entries client-side as the user types in the filter input', () => {
    const { fixture, root } = setup([
      { slug: 'alpha', hasParameters: false },
      { slug: 'algebra', hasParameters: false },
      { slug: 'zeta', hasParameters: false },
    ]);
    const filter = root.querySelector(
      '[data-testid="library-filter"]',
    ) as HTMLInputElement;
    filter.value = 'al';
    filter.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(visibleSlugs(root)).toEqual(['algebra', 'alpha']);
  });

  it('emits load when a load button is clicked, with the row slug', () => {
    const { fixture, root, component } = setup([
      { slug: 'alpha', hasParameters: false },
      { slug: 'beta', hasParameters: false },
    ]);
    const emitted: string[] = [];
    component.load.subscribe((slug: string) => emitted.push(slug));
    const buttons = root.querySelectorAll<HTMLButtonElement>(
      '[data-testid="library-entry-load"]',
    );
    buttons[1].click();
    fixture.detectChanges();
    expect(emitted).toEqual(['beta']);
  });

  it('emits delete when a delete button is clicked, with the row slug', () => {
    const { fixture, root, component } = setup([
      { slug: 'alpha', hasParameters: false },
      { slug: 'beta', hasParameters: false },
    ]);
    const emitted: string[] = [];
    component.delete.subscribe((slug: string) => emitted.push(slug));
    const buttons = root.querySelectorAll<HTMLButtonElement>(
      '[data-testid="library-entry-delete"]',
    );
    buttons[0].click();
    fixture.detectChanges();
    expect(emitted).toEqual(['alpha']);
  });
});
