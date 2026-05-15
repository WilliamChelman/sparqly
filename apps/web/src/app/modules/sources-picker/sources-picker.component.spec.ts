import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { SourcesPickerComponent } from './sources-picker.component';
import { ConfigService, type SourceListing } from '@app/core';

const TWO_SOURCE_LISTING: SourceListing = {
  sources: [
    { id: 'left', kind: 'glob', label: 'left (glob)' },
    { id: 'right', kind: 'glob', label: 'right (glob)', default: true },
  ],
};

function setup(listing: SourceListing) {
  const stub: Pick<ConfigService, 'list'> = {
    list: () => of(listing),
  };
  TestBed.configureTestingModule({
    providers: [{ provide: ConfigService, useValue: stub }],
  });
  const fixture = TestBed.createComponent(SourcesPickerComponent);
  fixture.detectChanges();
  return { fixture };
}

describe('SourcesPickerComponent', () => {
  it('renders one option per source from the ConfigService listing when opened', () => {
    const { fixture } = setup(TWO_SOURCE_LISTING);
    const root = fixture.nativeElement as HTMLElement;
    (root.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const options = Array.from(
      root.querySelectorAll('[role="option"]'),
    ) as HTMLElement[];
    expect(options.map((o) => o.getAttribute('data-source-id'))).toEqual([
      'left',
      'right',
    ]);
    expect(options[1].textContent).toContain('right (glob)');
  });

  it('preselects the source marked default: true and emits its id', () => {
    const stub: Pick<ConfigService, 'list'> = {
      list: () => of(TWO_SOURCE_LISTING),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ConfigService, useValue: stub }],
    });
    const fixture = TestBed.createComponent(SourcesPickerComponent);
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((v: string) =>
      emitted.push(v),
    );
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(emitted).toEqual(['right']);
    const trigger = root.querySelector('button') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain('right (glob)');
  });

  it('does not override an explicit value with the default', () => {
    const stub: Pick<ConfigService, 'list'> = {
      list: () => of(TWO_SOURCE_LISTING),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ConfigService, useValue: stub }],
    });
    const fixture = TestBed.createComponent(SourcesPickerComponent);
    fixture.componentRef.setInput('value', 'left');
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((v: string) =>
      emitted.push(v),
    );
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector('button') as HTMLButtonElement;
    expect(trigger.textContent).toContain('left (glob)');
    expect(emitted).toEqual([]);
  });

  it('emits valueChange and updates the trigger when a different option is picked', () => {
    const { fixture } = setup(TWO_SOURCE_LISTING);
    const root = fixture.nativeElement as HTMLElement;
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((v: string) =>
      emitted.push(v),
    );
    (root.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const leftOption = root.querySelector(
      '[data-source-id="left"]',
    ) as HTMLElement;
    leftOption.click();
    fixture.detectChanges();
    const trigger = root.querySelector('button') as HTMLButtonElement;
    expect(emitted).toEqual(['left']);
    expect(trigger.textContent).toContain('left (glob)');
  });

  it('marks the trigger as a listbox popup, closed by default', () => {
    const { fixture } = setup(TWO_SOURCE_LISTING);
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector('button') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('[role="listbox"]')).toBeFalsy();
  });

  it('opens the listbox when the trigger is clicked', () => {
    const { fixture } = setup(TWO_SOURCE_LISTING);
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector('button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('[role="listbox"]')).toBeTruthy();
    expect(
      root.querySelectorAll('[role="option"]').length,
    ).toBe(TWO_SOURCE_LISTING.sources.length);
  });

  it('closes the listbox on Escape', () => {
    const { fixture } = setup(TWO_SOURCE_LISTING);
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector('button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const listbox = root.querySelector('[role="listbox"]') as HTMLElement;
    expect(listbox).toBeTruthy();
    listbox.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('[role="listbox"]')).toBeFalsy();
  });

  it('closes the listbox after picking an option', () => {
    const { fixture } = setup(TWO_SOURCE_LISTING);
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector('button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const leftOption = root.querySelector(
      '[data-source-id="left"]',
    ) as HTMLElement;
    leftOption.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('[role="listbox"]')).toBeFalsy();
  });

  it('auto-expands the parent group when the selected id is a child, so the cdkListbox value matches a rendered option', () => {
    const grouped: SourceListing = {
      sources: [
        { id: 'docs', kind: 'glob', label: 'docs (glob)', default: true },
        { id: 'docs/a.ttl', kind: 'file', label: 'a.ttl', parentId: 'docs' },
        { id: 'docs/b.ttl', kind: 'file', label: 'b.ttl', parentId: 'docs' },
      ],
    };
    const stub: Pick<ConfigService, 'list'> = { list: () => of(grouped) };
    TestBed.configureTestingModule({
      providers: [{ provide: ConfigService, useValue: stub }],
    });
    const fixture = TestBed.createComponent(SourcesPickerComponent);
    fixture.componentRef.setInput('value', 'docs/a.ttl');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    (root.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    // The child option MUST be rendered (its parent auto-expanded) — otherwise
    // CdkListbox throws "Listbox has selected values that do not match any of its options".
    const child = root.querySelector('[data-source-id="docs/a.ttl"]');
    expect(child).toBeTruthy();
    expect(child?.getAttribute('aria-selected')).toBe('true');
  });

  it('preselects the meta (not a child) when the meta is the default, and selecting a child swaps the selection mutually exclusive (ADR-0005)', () => {
    const grouped: SourceListing = {
      sources: [
        { id: 'docs', kind: 'glob', label: 'docs (glob)', default: true },
        { id: 'docs/a.ttl', kind: 'file', label: 'a.ttl', parentId: 'docs' },
        { id: 'docs/b.ttl', kind: 'file', label: 'b.ttl', parentId: 'docs' },
      ],
    };
    const stub: Pick<ConfigService, 'list'> = { list: () => of(grouped) };
    TestBed.configureTestingModule({
      providers: [{ provide: ConfigService, useValue: stub }],
    });
    const fixture = TestBed.createComponent(SourcesPickerComponent);
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((v: string) =>
      emitted.push(v),
    );
    fixture.detectChanges();
    expect(emitted).toEqual(['docs']);
    const root = fixture.nativeElement as HTMLElement;
    (root.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const toggle = root.querySelector(
      '[data-testid="group-toggle-docs"]',
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    const child = root.querySelector(
      '[data-source-id="docs/a.ttl"]',
    ) as HTMLElement;
    child.click();
    fixture.detectChanges();
    expect(emitted).toEqual(['docs', 'docs/a.ttl']);
    // Reopen and verify single-select: only one option is aria-selected
    (root.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    // Re-expand if needed
    const toggle2 = root.querySelector(
      '[data-testid="group-toggle-docs"]',
    ) as HTMLButtonElement;
    if (!root.querySelector('[data-source-id="docs/a.ttl"]')) toggle2.click();
    fixture.detectChanges();
    const selected = Array.from(
      root.querySelectorAll('[aria-selected="true"]'),
    ).map((el) => el.getAttribute('data-source-id'));
    expect(selected).toEqual(['docs/a.ttl']);
  });

  it('hides children behind a collapse toggle on the meta row; expanding reveals them', () => {
    const grouped: SourceListing = {
      sources: [
        { id: 'docs', kind: 'glob', label: 'docs (glob)', default: true },
        { id: 'docs/a.ttl', kind: 'file', label: 'a.ttl', parentId: 'docs' },
        { id: 'docs/b.ttl', kind: 'file', label: 'b.ttl', parentId: 'docs' },
      ],
    };
    const { fixture } = setup(grouped);
    const root = fixture.nativeElement as HTMLElement;
    (root.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    // Children are NOT visible yet — collapsed by default
    expect(root.querySelector('[data-source-id="docs/a.ttl"]')).toBeFalsy();
    expect(root.querySelector('[data-source-id="docs/b.ttl"]')).toBeFalsy();
    // Toggle the meta's group
    const toggle = root.querySelector(
      '[data-testid="group-toggle-docs"]',
    ) as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    toggle.click();
    fixture.detectChanges();
    expect(root.querySelector('[data-source-id="docs/a.ttl"]')).toBeTruthy();
    expect(root.querySelector('[data-source-id="docs/b.ttl"]')).toBeTruthy();
  });

  it('renders a "(N files)" badge on a meta entry that has children grouped under it', () => {
    const grouped: SourceListing = {
      sources: [
        { id: 'docs', kind: 'glob', label: 'docs (glob)', default: true },
        { id: 'docs/a.ttl', kind: 'file', label: 'a.ttl', parentId: 'docs' },
        { id: 'docs/b.ttl', kind: 'file', label: 'b.ttl', parentId: 'docs' },
      ],
    };
    const { fixture } = setup(grouped);
    const root = fixture.nativeElement as HTMLElement;
    (root.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const docsOption = root.querySelector(
      '[data-source-id="docs"]',
    ) as HTMLElement;
    expect(docsOption).toBeTruthy();
    expect(docsOption.textContent).toContain('(2 files)');
  });

  it('shows a loading hint until the listing arrives', () => {
    const subj = new Subject<SourceListing>();
    const stub: Pick<ConfigService, 'list'> = {
      list: () => subj.asObservable(),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ConfigService, useValue: stub }],
    });
    const fixture = TestBed.createComponent(SourcesPickerComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent ?? '').toContain('loading sources');
    expect(root.querySelector('button')).toBeFalsy();
  });
});
