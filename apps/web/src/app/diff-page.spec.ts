import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { DiffPage } from './diff-page';
import { SourcesPicker } from './sources-picker';
import { SourcesService, type SourceListing } from './sources.service';
import {
  DiffService,
  type DiffRequest,
  type DiffResponse,
} from './diff.service';

@Component({
  selector: 'app-sources-picker',
  standalone: true,
  template: `<div [attr.data-testid]="'stub-picker-' + label">
    {{ label }}:{{ value }}
  </div>`,
})
class SourcesPickerStub {
  @Input() label = 'side';
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();
}

const TWO: SourceListing = {
  sources: [
    { id: 'a', kind: 'glob', label: 'A (glob)' },
    { id: 'b', kind: 'glob', label: 'B (glob)', default: true },
  ],
};

const ONE: SourceListing = {
  sources: [{ id: 'a', kind: 'glob', label: 'A (glob)' }],
};

const ZERO: SourceListing = { sources: [] };

interface RecordedDiffCall {
  request: DiffRequest;
  responses: Subject<DiffResponse>;
}

interface DiffStub extends Pick<DiffService, 'run'> {
  calls: RecordedDiffCall[];
}

function makeDiffStub(): DiffStub {
  const calls: RecordedDiffCall[] = [];
  const stub: DiffStub = {
    calls,
    run(req: DiffRequest) {
      const subj = new Subject<DiffResponse>();
      calls.push({ request: req, responses: subj });
      return subj.asObservable();
    },
  };
  return stub;
}

function setup(listing: SourceListing) {
  const sourcesStub: Pick<SourcesService, 'list'> = { list: () => of(listing) };
  const diffStub = makeDiffStub();

  TestBed.configureTestingModule({
    imports: [DiffPage],
    providers: [
      { provide: SourcesService, useValue: sourcesStub },
      { provide: DiffService, useValue: diffStub },
    ],
  })
    .overrideComponent(DiffPage, {
      remove: { imports: [SourcesPicker] },
      add: { imports: [SourcesPickerStub] },
    })
    .compileComponents();

  const fixture = TestBed.createComponent(DiffPage);
  fixture.detectChanges();
  return { fixture, diffStub };
}

function pickerStubs(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): { left: SourcesPickerStub; right: SourcesPickerStub } {
  const all = fixture.debugElement
    .queryAll((n) => n.componentInstance instanceof SourcesPickerStub)
    .map((d) => d.componentInstance as SourcesPickerStub);
  const left = all.find((s) => s.label === 'left');
  const right = all.find((s) => s.label === 'right');
  if (!left || !right) {
    throw new Error(
      `expected pickers with label=left and label=right, got [${all
        .map((s) => s.label)
        .join(', ')}]`,
    );
  }
  return { left, right };
}

describe('DiffPage', () => {
  it('renders two pickers, two editors, and a Run button when registry has ≥2 entries', () => {
    const { fixture } = setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('app-sources-picker').length).toBe(2);
    expect(root.querySelectorAll('textarea').length).toBe(2);
    expect(root.querySelector('button[data-testid=run-diff]')).toBeTruthy();
  });

  it('shows the empty-state when the registry has ≤1 entries (single-source mode)', () => {
    const { fixture } = setup(ONE);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid=empty-state]')).toBeTruthy();
    expect(root.querySelector('app-sources-picker')).toBeFalsy();
    expect(root.querySelector('button[data-testid=run-diff]')).toBeFalsy();
  });

  it('shows the empty-state when the registry has 0 entries', () => {
    const { fixture } = setup(ZERO);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid=empty-state]')).toBeTruthy();
  });

  it('Run delegates to DiffService with picked ids and editor text, and renders the JSON response', async () => {
    const { fixture, diffStub } = setup(TWO);
    const root = fixture.nativeElement as HTMLElement;

    const { left, right } = pickerStubs(fixture);
    left.valueChange.emit('a');
    right.valueChange.emit('b');

    const [leftTa, rightTa] = Array.from(
      root.querySelectorAll('textarea'),
    ) as HTMLTextAreaElement[];
    leftTa.value = 'SELECT * { ?s ?p ?o }';
    leftTa.dispatchEvent(new Event('input'));
    rightTa.value = 'SELECT * { ?s ?p ?o }';
    rightTa.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (root.querySelector('button[data-testid=run-diff]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(diffStub.calls.length).toBe(1);
    expect(diffStub.calls[0].request).toEqual({
      left: 'a',
      right: 'b',
      leftQuery: 'SELECT * { ?s ?p ?o }',
      rightQuery: 'SELECT * { ?s ?p ?o }',
    });
    diffStub.calls[0].responses.next({
      kind: 'graph',
      diff: { added: [], removed: [], totals: { left: 0, right: 0 } },
      sourceRecords: { left: {}, right: {} },
      totals: { left: 0, right: 0 },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const pre = root.querySelector('[data-testid=diff-result]') as HTMLElement | null;
    expect(pre?.textContent).toContain('"kind": "graph"');
  });

  it('keeps editor text when the picked @id changes', () => {
    const { fixture } = setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    const [leftTa] = Array.from(
      root.querySelectorAll('textarea'),
    ) as HTMLTextAreaElement[];
    leftTa.value = 'SELECT * WHERE { ?s ?p ?o }';
    leftTa.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const { left: leftStub } = pickerStubs(fixture);
    leftStub.valueChange.emit('b');
    leftStub.valueChange.emit('a');
    fixture.detectChanges();

    expect((root.querySelectorAll('textarea')[0] as HTMLTextAreaElement).value).toBe(
      'SELECT * WHERE { ?s ?p ?o }',
    );
  });

  it('renders both per-side errors at once when DiffService returns an error response', async () => {
    const { fixture, diffStub } = setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    const { left, right } = pickerStubs(fixture);
    left.valueChange.emit('a');
    right.valueChange.emit('b');
    fixture.detectChanges();

    (root.querySelector('button[data-testid=run-diff]') as HTMLButtonElement).click();
    fixture.detectChanges();

    diffStub.calls[0].responses.next({
      kind: 'error',
      errors: { left: 'left boom', right: 'right boom' },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      (root.querySelector('[data-testid=error-left]') as HTMLElement | null)
        ?.textContent,
    ).toContain('left boom');
    expect(
      (root.querySelector('[data-testid=error-right]') as HTMLElement | null)
        ?.textContent,
    ).toContain('right boom');
  });
});
