import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { SourcesPickerComponent } from './sources-picker.component';
import { ConfigService, type SourceListing } from '@app/core';
import type { RefsResponse } from './refs-api.client';

const REFS_OK: RefsResponse = {
  head: { ref: 'HEAD', sha: 'a'.repeat(40), kind: 'head' },
  branches: [{ ref: 'main', sha: 'a'.repeat(40), kind: 'branch' }],
  remoteBranches: [],
  tags: [],
};

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
    providers: [
      { provide: ConfigService, useValue: stub },
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const fixture = TestBed.createComponent(SourcesPickerComponent);
  const emitted: string[] = [];
  fixture.componentInstance.valueChange.subscribe((v: string) =>
    emitted.push(v),
  );
  fixture.detectChanges();
  return { fixture, emitted };
}

function trigger(root: HTMLElement): HTMLButtonElement {
  return root.querySelector(
    '[data-testid="sources-picker-trigger"]',
  ) as HTMLButtonElement;
}

function overlay(root: HTMLElement): HTMLElement | null {
  return root.querySelector('[data-testid="sources-overlay"]');
}

describe('SourcesPickerComponent', () => {
  it('preselects the source marked default: true and emits its id', () => {
    const stub: Pick<ConfigService, 'list'> = {
      list: () => of(TWO_SOURCE_LISTING),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ConfigService, useValue: stub },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(SourcesPickerComponent);
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((v: string) =>
      emitted.push(v),
    );
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(emitted).toEqual(['right']);
    expect(trigger(root).textContent).toContain('right (glob)');
  });

  it('does not override an explicit value with the default', () => {
    const stub: Pick<ConfigService, 'list'> = {
      list: () => of(TWO_SOURCE_LISTING),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ConfigService, useValue: stub },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(SourcesPickerComponent);
    fixture.componentRef.setInput('value', 'left');
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((v: string) =>
      emitted.push(v),
    );
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(trigger(root).textContent).toContain('left (glob)');
    expect(emitted).toEqual([]);
  });

  it('marks the trigger as a dialog popup, closed by default', () => {
    const { fixture } = setup(TWO_SOURCE_LISTING);
    const root = fixture.nativeElement as HTMLElement;
    const t = trigger(root);
    expect(t.getAttribute('aria-haspopup')).toBe('dialog');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(overlay(root)).toBeFalsy();
  });

  it('opens the overlay when the trigger is clicked', () => {
    const { fixture } = setup(TWO_SOURCE_LISTING);
    const root = fixture.nativeElement as HTMLElement;
    trigger(root).click();
    fixture.detectChanges();
    expect(trigger(root).getAttribute('aria-expanded')).toBe('true');
    expect(overlay(root)).toBeTruthy();
  });

  it('closes the overlay on Escape and reverts to the previously-applied selection', () => {
    const { fixture, emitted } = setup(TWO_SOURCE_LISTING);
    const root = fixture.nativeElement as HTMLElement;
    trigger(root).click();
    fixture.detectChanges();
    const o = overlay(root)!;
    (root.querySelector('[data-source-id="left"]') as HTMLElement).click();
    fixture.detectChanges();
    o.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(overlay(root)).toBeFalsy();
    // Only the initial default-driven emit; staged click was discarded.
    expect(emitted).toEqual(['right']);
    expect(trigger(root).textContent).toContain('right (glob)');
  });

  it('Apply emits the staged selection and closes; Cancel reverts and closes', () => {
    const { fixture, emitted } = setup(TWO_SOURCE_LISTING);
    const root = fixture.nativeElement as HTMLElement;
    // Open, click a row, Apply: emits and closes
    trigger(root).click();
    fixture.detectChanges();
    (root.querySelector('[data-source-id="left"]') as HTMLElement).click();
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="overlay-apply"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(emitted).toEqual(['right', 'left']);
    expect(overlay(root)).toBeFalsy();
    expect(trigger(root).textContent).toContain('left (glob)');
    // Reopen, stage right (back to default), Cancel: no emit, trigger unchanged
    trigger(root).click();
    fixture.detectChanges();
    (root.querySelector('[data-source-id="right"]') as HTMLElement).click();
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="overlay-cancel"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(emitted).toEqual(['right', 'left']);
    expect(trigger(root).textContent).toContain('left (glob)');
  });

  it('reopening the overlay starts at the previously-applied selection (initialSelectedId reflects the applied value)', () => {
    const { fixture } = setup(TWO_SOURCE_LISTING);
    const root = fixture.nativeElement as HTMLElement;
    // Default = right is applied. Reopen and verify the overlay sees 'right'.
    trigger(root).click();
    fixture.detectChanges();
    // Apply without picking anything: the staged id == initial selection.
    (
      root.querySelector('[data-testid="overlay-apply"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    // No change should re-emit
    expect(trigger(root).textContent).toContain('right (glob)');
  });

  it('Apply with no change does not re-emit valueChange', () => {
    const { fixture, emitted } = setup(TWO_SOURCE_LISTING);
    const root = fixture.nativeElement as HTMLElement;
    trigger(root).click();
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="overlay-apply"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(emitted).toEqual(['right']); // only the init emit
  });

  it('renders the underlying source label plus a ref chip when value is `@id:ref` (ADR-0029, #279)', () => {
    const stub: Pick<ConfigService, 'list'> = {
      list: () => of(TWO_SOURCE_LISTING),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ConfigService, useValue: stub },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(SourcesPickerComponent);
    fixture.componentRef.setInput('value', '@right:v1.2.0');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(trigger(root).textContent).toContain('right (glob)');
    const chip = root.querySelector('[data-testid="pinned-ref-chip"]');
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain('v1.2.0');
  });

  it('renders a "moving ref" note when the pinned ref is floating-shaped (ADR-0029 floating-ref, #279)', () => {
    const stub: Pick<ConfigService, 'list'> = {
      list: () => of(TWO_SOURCE_LISTING),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ConfigService, useValue: stub },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(SourcesPickerComponent);
    fixture.componentRef.setInput('value', '@right:main');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const note = root.querySelector('[data-testid="floating-ref-note"]');
    expect(note).toBeTruthy();
    expect(note?.textContent?.toLowerCase()).toContain('moving ref');
    expect(note?.textContent?.toLowerCase()).toContain('refresh remotes');
  });

  it('omits the "moving ref" note when the pinned ref is a full SHA (40 hex chars)', () => {
    const stub: Pick<ConfigService, 'list'> = {
      list: () => of(TWO_SOURCE_LISTING),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ConfigService, useValue: stub },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(SourcesPickerComponent);
    fixture.componentRef.setInput(
      'value',
      '@right:0123456789abcdef0123456789abcdef01234567',
    );
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="floating-ref-note"]')).toBeFalsy();
  });

  it('omits the "moving ref" note when no ref is in use (unpinned value)', () => {
    const { fixture } = setup(TWO_SOURCE_LISTING);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="floating-ref-note"]')).toBeFalsy();
  });

  it('picking a different option and applying emits the bare id and clears the ref chip (pin does not stick across selection)', () => {
    const stub: Pick<ConfigService, 'list'> = {
      list: () => of(TWO_SOURCE_LISTING),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ConfigService, useValue: stub },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(SourcesPickerComponent);
    fixture.componentRef.setInput('value', '@right:v1.2.0');
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((v: string) =>
      emitted.push(v),
    );
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    trigger(root).click();
    fixture.detectChanges();
    (root.querySelector('[data-source-id="left"]') as HTMLElement).click();
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="overlay-apply"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(emitted).toEqual(['left']);
    expect(root.querySelector('[data-testid="pinned-ref-chip"]')).toBeFalsy();
    expect(trigger(root).textContent).toContain('left (glob)');
  });

  it('reuses the refs cache while the overlay stays open (no second HTTP request when refocusing the same source)', () => {
    const { fixture } = setup(TWO_SOURCE_LISTING);
    const http = TestBed.inject(HttpTestingController);
    const root = fixture.nativeElement as HTMLElement;
    trigger(root).click();
    fixture.detectChanges();
    const req1 = http.expectOne('/api/sources/right/refs');
    req1.flush(REFS_OK);
    fixture.detectChanges();
    // Refocusing the same source row should not trigger a new request.
    (root.querySelector('[data-source-id="right"]') as HTMLElement).click();
    fixture.detectChanges();
    http.expectNone('/api/sources/right/refs');
    http.verify();
  });

  it('drops the refs cache when the overlay closes — reopening on the same source re-fetches', () => {
    const { fixture } = setup(TWO_SOURCE_LISTING);
    const http = TestBed.inject(HttpTestingController);
    const root = fixture.nativeElement as HTMLElement;
    // Open #1
    trigger(root).click();
    fixture.detectChanges();
    http.expectOne('/api/sources/right/refs').flush(REFS_OK);
    fixture.detectChanges();
    // Close via Cancel
    (
      root.querySelector('[data-testid="overlay-cancel"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    // Open #2 — cache should have been dropped with the previous overlay instance.
    trigger(root).click();
    fixture.detectChanges();
    const req2 = http.expectOne('/api/sources/right/refs');
    req2.flush(REFS_OK);
    http.verify();
  });

  it('shows a loading hint until the listing arrives', () => {
    const subj = new Subject<SourceListing>();
    const stub: Pick<ConfigService, 'list'> = {
      list: () => subj.asObservable(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ConfigService, useValue: stub },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(SourcesPickerComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent ?? '').toContain('loading sources');
    expect(trigger(root)).toBeFalsy();
  });
});
