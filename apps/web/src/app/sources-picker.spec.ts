import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { SourcesPicker } from './sources-picker';
import { ConfigService, type SourceListing } from './config.service';

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
  const fixture = TestBed.createComponent(SourcesPicker);
  fixture.detectChanges();
  return { fixture };
}

describe('SourcesPicker', () => {
  it('renders an <option> per registry source from the ConfigService', () => {
    const { fixture } = setup(TWO_SOURCE_LISTING);
    const options = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('option'),
    ) as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(['left', 'right']);
    expect(options[1].textContent?.trim()).toBe('right (glob)');
  });

  it('preselects the entry marked default: true', () => {
    const { fixture } = setup(TWO_SOURCE_LISTING);
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      'select',
    ) as HTMLSelectElement;
    expect(select.value).toBe('right');
  });

  it('emits valueChange when the user picks a different @id', () => {
    const { fixture } = setup(TWO_SOURCE_LISTING);
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      'select',
    ) as HTMLSelectElement;
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((v: string) =>
      emitted.push(v),
    );
    select.value = 'left';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(emitted).toEqual(['left']);
  });

  it('shows a loading hint until the listing arrives', () => {
    const subj = new Subject<SourceListing>();
    const stub: Pick<ConfigService, 'list'> = { list: () => subj.asObservable() };
    TestBed.configureTestingModule({
      providers: [{ provide: ConfigService, useValue: stub }],
    });
    const fixture = TestBed.createComponent(SourcesPicker);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).textContent ?? '',
    ).toContain('loading sources');
    subj.next(TWO_SOURCE_LISTING);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('select'),
    ).toBeTruthy();
  });
});
