import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { SourcesPickerComponent } from '@app/modules/sources-picker';
import { YasqeEditorComponent } from '@app/modules/yasqe-editor';
import { DiffPage } from './diff.page';
import { DiffHunkComponent } from './components/diff-hunk.component';
import { SourceSnippetComponent } from './components/source-snippet.component';
import {
  ConfigService,
  type ConfigPayload,
  type SourceListing,
} from '@app/core';
import {
  DiffService,
  type DiffRequest,
  type DiffResponse,
} from './services/diff.service';

@Component({
  selector: 'app-source-snippet',
  standalone: true,
  template: `<div
    data-testid="snippet-stub"
    [attr.data-file]="file"
    [attr.data-focal-start]="focalStart"
    [attr.data-focal-end]="focalEnd"
    [attr.data-context]="context"
  ></div>`,
})
class SourceSnippetStub {
  @Input() file = '';
  @Input() focalStart = 0;
  @Input() focalEnd = 0;
  @Input() context = 0;
}

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

@Component({
  selector: 'app-yasqe-editor',
  standalone: true,
  template: `<textarea
    [value]="value"
    (input)="valueChange.emit($any($event.target).value)"
  ></textarea>`,
})
class YasqeEditorStub {
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

async function setup(listing: SourceListing, initialUrl = '/diff') {
  const payload: ConfigPayload = {
    sources: listing.sources,
    context: { prefixes: {} },
  };
  const configStub: Pick<ConfigService, 'list' | 'config' | 'context'> = {
    list: () => of(listing),
    config: () => of(payload),
    context: () => of(payload.context),
  };
  const diffStub = makeDiffStub();

  TestBed.configureTestingModule({
    imports: [DiffPage],
    providers: [
      provideRouter([{ path: 'diff', component: DiffPage }]),
      { provide: ConfigService, useValue: configStub },
      { provide: DiffService, useValue: diffStub },
    ],
  })
    .overrideComponent(DiffPage, {
      remove: { imports: [SourcesPickerComponent, YasqeEditorComponent] },
      add: { imports: [SourcesPickerStub, YasqeEditorStub] },
    })
    .overrideComponent(DiffHunkComponent, {
      remove: { imports: [SourceSnippetComponent] },
      add: { imports: [SourceSnippetStub] },
    })
    .compileComponents();

  const router = TestBed.inject(Router);
  await router.navigateByUrl(initialUrl);
  const fixture = TestBed.createComponent(DiffPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, diffStub, router };
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
  it('renders two pickers, two editors, and a Run button when registry has ≥2 entries', async () => {
    const { fixture } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('app-sources-picker').length).toBe(2);
    expect(root.querySelectorAll('textarea').length).toBe(2);
    expect(root.querySelector('button[data-testid=run-diff]')).toBeTruthy();
  });

  it('shows the empty-state when the registry has ≤1 entries (single-source mode)', async () => {
    const { fixture } = await setup(ONE);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid=empty-state]')).toBeTruthy();
    expect(root.querySelector('app-sources-picker')).toBeFalsy();
    expect(root.querySelector('button[data-testid=run-diff]')).toBeFalsy();
  });

  it('shows the empty-state when the registry has 0 entries', async () => {
    const { fixture } = await setup(ZERO);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid=empty-state]')).toBeTruthy();
  });

  it('Run delegates to DiffService with picked ids and editor text, and renders the response via DiffResultRenderer', async () => {
    const { fixture, diffStub } = await setup(TWO);
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
      kind: 'grouped',
      hunked: {
        changed: [],
        removed: [],
        added: [
          {
            anchor: 'http://example.org/a',
            state: 'added',
            removed: 0,
            added: 1,
            lines: [
              {
                side: '+',
                subjectPath: 'http://example.org/a',
                predicate: 'http://example.org/p',
                object: '<http://example.org/b>',
                nquad:
                  '<http://example.org/a> <http://example.org/p> <http://example.org/b> .',
              },
            ],
            sourceRecords: { left: [], right: [] },
          },
        ],
        totals: { left: 0, right: 1 },
      },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(root.querySelector('[data-testid=diff-totals]')?.textContent).toContain(
      'left=0 right=1 +1 -0',
    );
    expect(root.querySelectorAll('[data-testid=added-line]').length).toBe(1);
  });

  it('keeps editor text when the picked @id changes', async () => {
    const { fixture } = await setup(TWO);
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

  it('exposes an advanced disclosure with skipAutoSourceAnnotation checkbox (default off) and context number input (default 3)', async () => {
    const { fixture } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    const skip = root.querySelector(
      'input[data-testid=skip-auto-source-annotation]',
    ) as HTMLInputElement | null;
    const ctx = root.querySelector(
      'input[data-testid=snippet-context]',
    ) as HTMLInputElement | null;
    expect(skip).toBeTruthy();
    expect(skip?.type).toBe('checkbox');
    expect(skip?.checked).toBe(false);
    expect(ctx).toBeTruthy();
    expect(ctx?.type).toBe('number');
    expect(ctx?.value).toBe('3');
  });

  it('forwards skipAutoSourceAnnotation in the /api/diff request body when checked', async () => {
    const { fixture, diffStub } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    const { left, right } = pickerStubs(fixture);
    left.valueChange.emit('a');
    right.valueChange.emit('b');
    fixture.detectChanges();

    const skip = root.querySelector(
      'input[data-testid=skip-auto-source-annotation]',
    ) as HTMLInputElement;
    skip.checked = true;
    skip.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    (root.querySelector('button[data-testid=run-diff]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(diffStub.calls.length).toBe(1);
    expect(diffStub.calls[0].request.skipAutoSourceAnnotation).toBe(true);
  });

  it('forwards the context input value into the DiffResultRenderer', async () => {
    const { fixture, diffStub } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    const { left, right } = pickerStubs(fixture);
    left.valueChange.emit('a');
    right.valueChange.emit('b');
    fixture.detectChanges();

    const ctx = root.querySelector(
      'input[data-testid=snippet-context]',
    ) as HTMLInputElement;
    ctx.value = '7';
    ctx.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (root.querySelector('button[data-testid=run-diff]') as HTMLButtonElement).click();
    fixture.detectChanges();
    diffStub.calls[0].responses.next({
      kind: 'grouped',
      hunked: {
        changed: [],
        removed: [],
        added: [
          {
            anchor: 'http://example.org/a',
            state: 'added',
            removed: 0,
            added: 1,
            lines: [
              {
                side: '+',
                subjectPath: 'http://example.org/a',
                predicate: 'http://example.org/p',
                object: '<http://example.org/b>',
                nquad:
                  '<http://example.org/a> <http://example.org/p> <http://example.org/b> .',
              },
            ],
            sourceRecords: {
              left: [],
              right: [{ file: 'file:///tmp/right.ttl', line: 4 }],
            },
          },
        ],
        totals: { left: 0, right: 1 },
      },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const stub = root.querySelector('[data-testid=snippet-stub]') as HTMLElement | null;
    expect(stub).toBeTruthy();
    expect(stub?.getAttribute('data-context')).toBe('7');
  });

  it('renders both per-side errors at once when DiffService returns an error response', async () => {
    const { fixture, diffStub } = await setup(TWO);
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

  it('seeds the picked sources and queries from URL query params', async () => {
    const initialUrl =
      '/diff?left=a&right=b' +
      '&leftQuery=' +
      encodeURIComponent('SELECT ?l { ?l ?p ?o }') +
      '&rightQuery=' +
      encodeURIComponent('SELECT ?r { ?r ?p ?o }');
    const { fixture } = await setup(TWO, initialUrl);
    const root = fixture.nativeElement as HTMLElement;
    const { left, right } = pickerStubs(fixture);
    expect(left.value).toBe('a');
    expect(right.value).toBe('b');
    const [leftTa, rightTa] = Array.from(
      root.querySelectorAll('textarea'),
    ) as HTMLTextAreaElement[];
    expect(leftTa.value).toBe('SELECT ?l { ?l ?p ?o }');
    expect(rightTa.value).toBe('SELECT ?r { ?r ?p ?o }');
  });

  it('mirrors picked sources and queries into URL query params', async () => {
    const { fixture, router } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    const { left, right } = pickerStubs(fixture);
    left.valueChange.emit('a');
    right.valueChange.emit('b');
    fixture.detectChanges();
    const [leftTa, rightTa] = Array.from(
      root.querySelectorAll('textarea'),
    ) as HTMLTextAreaElement[];
    leftTa.value = 'SELECT ?l { ?l ?p ?o }';
    leftTa.dispatchEvent(new Event('input'));
    rightTa.value = 'SELECT ?r { ?r ?p ?o }';
    rightTa.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    const tree = router.parseUrl(router.url);
    expect(tree.queryParamMap.get('left')).toBe('a');
    expect(tree.queryParamMap.get('right')).toBe('b');
    expect(tree.queryParamMap.get('leftQuery')).toBe('SELECT ?l { ?l ?p ?o }');
    expect(tree.queryParamMap.get('rightQuery')).toBe('SELECT ?r { ?r ?p ?o }');
  });
});
