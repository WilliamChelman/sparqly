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
