import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import {
  ConfigService,
  type SourceListing,
  type SourceListingEntry,
} from '@app/core';
import { MultiSourcesPickerComponent } from './multi-sources-picker.component';

const THREE_SOURCE_LISTING: SourceListing = {
  sources: [
    { id: 'alpha', kind: 'glob', label: 'alpha (glob)' },
    { id: 'beta', kind: 'glob', label: 'beta (glob)' },
    { id: 'gamma', kind: 'endpoint', label: 'gamma (endpoint)' },
  ],
};

function setup(listing: SourceListing, excludeKinds: string[] = ['empty']) {
  const stub: Pick<ConfigService, 'list'> = {
    list: () => of(listing),
  };
  TestBed.configureTestingModule({
    providers: [{ provide: ConfigService, useValue: stub }],
  });
  const fixture = TestBed.createComponent(MultiSourcesPickerComponent);
  fixture.componentRef.setInput('excludeKinds', excludeKinds);
  return { fixture };
}

describe('MultiSourcesPickerComponent', () => {
  it('renders one toggleable option per included source', () => {
    const { fixture } = setup(THREE_SOURCE_LISTING);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    (root.querySelector('button[data-testid="multi-sources-trigger"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const options = Array.from(
      root.querySelectorAll('[data-source-id]'),
    ) as HTMLElement[];
    expect(options.map((o) => o.getAttribute('data-source-id'))).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  it('filters out sources whose kind matches excludeKinds', () => {
    const listingWithEmpty: SourceListing = {
      sources: [
        { id: 'alpha', kind: 'glob', label: 'alpha' },
        { id: 'beta', kind: 'empty', label: 'beta' } as SourceListingEntry,
        { id: 'gamma', kind: 'glob', label: 'gamma' },
      ],
    };
    const { fixture } = setup(listingWithEmpty, ['empty']);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    (root.querySelector('button[data-testid="multi-sources-trigger"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const ids = Array.from(root.querySelectorAll('[data-source-id]')).map(
      (e) => e.getAttribute('data-source-id'),
    );
    expect(ids).toEqual(['alpha', 'gamma']);
  });

  it('initial state selects every included source and emits that list', () => {
    const emitted: string[][] = [];
    const { fixture } = setup(THREE_SOURCE_LISTING);
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
    expect(emitted).toEqual([['alpha', 'beta', 'gamma']]);
  });

  it('honours an explicit `value` input and does not override it with the all-selected default', () => {
    const emitted: string[][] = [];
    const { fixture } = setup(THREE_SOURCE_LISTING);
    fixture.componentRef.setInput('value', ['beta']);
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
    expect(emitted).toEqual([]);
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector('button[data-testid="multi-sources-trigger"]') as HTMLElement;
    expect(trigger.textContent).toContain('1');
  });

  it('toggles a source on click and emits the updated selection', () => {
    const emitted: string[][] = [];
    const { fixture } = setup(THREE_SOURCE_LISTING);
    fixture.detectChanges();
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    const root = fixture.nativeElement as HTMLElement;
    (root.querySelector('button[data-testid="multi-sources-trigger"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const alpha = root.querySelector('[data-source-id="alpha"]') as HTMLElement;
    alpha.click();
    fixture.detectChanges();
    expect(emitted[0]).toEqual(['beta', 'gamma']);
  });

  it('zero selected sources shows a "Select all" affordance that restores every source', () => {
    const { fixture } = setup(THREE_SOURCE_LISTING);
    fixture.componentRef.setInput('value', []);
    fixture.detectChanges();
    const emitted: string[][] = [];
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    const root = fixture.nativeElement as HTMLElement;
    const selectAll = root.querySelector('[data-testid="select-all"]') as HTMLButtonElement;
    expect(selectAll).toBeTruthy();
    selectAll.click();
    fixture.detectChanges();
    expect(emitted[0]).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('Single-source mode (one included source) collapses to a locked row, no dropdown', () => {
    const single: SourceListing = {
      sources: [{ id: 'only', kind: 'glob', label: 'only (glob)' }],
    };
    const { fixture } = setup(single);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('button[data-testid="multi-sources-trigger"]')).toBeFalsy();
    const locked = root.querySelector('[data-testid="multi-sources-locked"]');
    expect(locked).toBeTruthy();
    expect(locked?.textContent).toContain('only');
  });

  it('shows a loading hint until the listing arrives', () => {
    const subj = new Subject<SourceListing>();
    const stub: Pick<ConfigService, 'list'> = {
      list: () => subj.asObservable(),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ConfigService, useValue: stub }],
    });
    const fixture = TestBed.createComponent(MultiSourcesPickerComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent ?? '').toContain('loading sources');
  });
});
