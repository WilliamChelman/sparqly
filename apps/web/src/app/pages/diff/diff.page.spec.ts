import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { LibraryComboboxComponent } from '@app/modules/library-combobox';
import { SourcesPickerComponent } from '@app/modules/sources-picker';
import { DiffPage } from './diff.page';
import { DiffHunkComponent } from './components/diff-hunk.component';
import { EditorFrameComponent } from '../query/components/editor-frame.component';
import { SourceSnippetComponent } from './components/source-snippet.component';
import {
  ConfigService,
  SavedQueriesService,
  type ConfigPayload,
  type LoadedSavedQuery,
  type SavedQueryEntry,
  type SavedQuerySummary,
  type SourceListing,
} from '@app/core';
import type {
  ParameterBindings,
  ParameterDeclaration,
} from 'common';
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
  selector: 'app-editor-frame',
  standalone: true,
  template: `<div [attr.data-testid]="'frame-' + name">
    <textarea
      [value]="value"
      (input)="valueChange.emit($any($event.target).value)"
    ></textarea>
    @if (loadError) {
      <span data-testid="frame-load-error"
        >{{ loadError.kind }}: {{ loadError.slug }}</span
      >
    }
  </div>`,
})
class EditorFrameStub {
  @Input() value = '';
  @Input() name = 'query';
  @Input() loadError?: { kind: 'not-found'; slug: string };
  @Input() parameters?: ReadonlyArray<ParameterDeclaration>;
  @Input() initialBindings?: ParameterBindings;
  @Output() valueChange = new EventEmitter<string>();
  @Output() submitBindings = new EventEmitter<ParameterBindings>();
}

@Component({
  selector: 'app-library-combobox',
  standalone: true,
  template: `<div data-testid="stub-library">
    <span data-testid="stub-library-selected">{{ selectedSlug ?? '' }}</span>
    <ul>
      @for (e of entries; track e.slug) {
        <li data-testid="stub-library-entry">{{ e.slug }}</li>
      }
    </ul>
  </div>`,
})
class LibraryComboboxStub {
  @Input() entries: readonly SavedQuerySummary[] = [];
  @Input() selectedSlug: string | null = null;
  // eslint-disable-next-line @angular-eslint/no-output-native
  @Output() load = new EventEmitter<string>();
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

interface SavedQueriesStubState {
  list: SavedQuerySummary[];
  entries: Record<string, { entry: SavedQueryEntry; etag: string }>;
  calls: {
    list: number;
    get: Array<{ slug: string }>;
  };
}

function makeSavedQueriesStub(
  initial: Partial<SavedQueriesStubState> = {},
): {
  state: SavedQueriesStubState;
  service: Pick<SavedQueriesService, 'list' | 'get'>;
} {
  const state: SavedQueriesStubState = {
    list: initial.list ?? [],
    entries: initial.entries ?? {},
    calls: { list: 0, get: [] },
  };
  const service: Pick<SavedQueriesService, 'list' | 'get'> = {
    list: () => {
      state.calls.list += 1;
      return of(state.list as readonly SavedQuerySummary[]);
    },
    get: (slug: string) => {
      state.calls.get.push({ slug });
      const found = state.entries[slug];
      if (!found) {
        return throwError(
          () =>
            new HttpErrorResponse({
              status: 404,
              statusText: 'Not Found',
              url: `/api/saved-queries/${slug}`,
            }),
        );
      }
      return of<LoadedSavedQuery>({ entry: found.entry, etag: found.etag });
    },
  };
  return { state, service };
}

async function setup(
  listing: SourceListing,
  initialUrl = '/diff',
  savedQueries: Partial<SavedQueriesStubState> = {},
) {
  const payload: ConfigPayload = {
    sources: listing.sources,
    context: { prefixes: {} },
    describe: {
      perSourceSoftLimit: 10000,
      perSourceHardLimit: 100000,
      fromSourcePredicate: 'urn:sparqly:fromSource',
    },
    savedQueries: { writable: true },
  };
  const configStub: Pick<ConfigService, 'list' | 'config' | 'context'> = {
    list: () => of(listing),
    config: () => of(payload),
    context: () => of(payload.context),
  };
  const diffStub = makeDiffStub();
  const savedQueriesStub = makeSavedQueriesStub(savedQueries);

  TestBed.configureTestingModule({
    imports: [DiffPage],
    providers: [
      provideRouter([{ path: 'diff', component: DiffPage }]),
      { provide: ConfigService, useValue: configStub },
      { provide: DiffService, useValue: diffStub },
      { provide: SavedQueriesService, useValue: savedQueriesStub.service },
    ],
  })
    .overrideComponent(DiffPage, {
      remove: {
        imports: [
          SourcesPickerComponent,
          EditorFrameComponent,
          LibraryComboboxComponent,
        ],
      },
      add: {
        imports: [SourcesPickerStub, EditorFrameStub, LibraryComboboxStub],
      },
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
  return {
    fixture,
    diffStub,
    router,
    savedQueriesState: savedQueriesStub.state,
  };
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

function frameStubs(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): { left: EditorFrameStub; right: EditorFrameStub } {
  const all = fixture.debugElement
    .queryAll((n) => n.componentInstance instanceof EditorFrameStub)
    .map((d) => d.componentInstance as EditorFrameStub);
  const left = all.find((f) => f.name === 'left');
  const right = all.find((f) => f.name === 'right');
  if (!left || !right) {
    throw new Error(
      `expected editor frames with name=left and name=right, got [${all
        .map((f) => f.name)
        .join(', ')}]`,
    );
  }
  return { left, right };
}

function libraryStubs(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): { left: LibraryComboboxStub; right: LibraryComboboxStub } {
  const nodes = fixture.debugElement.queryAll(
    (n) => n.componentInstance instanceof LibraryComboboxStub,
  );
  const lookup = (testid: string): LibraryComboboxStub => {
    const found = nodes.find(
      (n) =>
        (n.nativeElement as HTMLElement).getAttribute('data-testid') === testid,
    );
    if (!found)
      throw new Error(
        `expected a library combobox with data-testid=${testid}, got [${nodes
          .map(
            (n) =>
              (n.nativeElement as HTMLElement).getAttribute('data-testid') ?? '',
          )
          .join(', ')}]`,
      );
    return found.componentInstance as LibraryComboboxStub;
  };
  return { left: lookup('library-left'), right: lookup('library-right') };
}

describe('DiffPage', () => {
  it('renders two pickers, two editors, and a Run button when registry has ≥2 entries', async () => {
    const { fixture } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('app-sources-picker').length).toBe(2);
    expect(root.querySelectorAll('textarea').length).toBe(2);
    expect(root.querySelector('button[data-testid=run-diff]')).toBeTruthy();
  });

  it('renders an EditorFrame per side with names "left" and "right", and a LibraryCombobox per side', async () => {
    const { fixture } = await setup(TWO, '/diff', {
      list: [{ slug: 'sample', hasParameters: false }],
    });
    const { left, right } = frameStubs(fixture);
    expect(left.name).toBe('left');
    expect(right.name).toBe('right');
    const libs = libraryStubs(fixture);
    expect(libs.left.entries.map((e) => e.slug)).toEqual(['sample']);
    expect(libs.right.entries.map((e) => e.slug)).toEqual(['sample']);
  });

  it('renders no authoring affordances per side (no save/save-as/delete/stale/save-as dialogs) — run surface per ADR-0038', async () => {
    const { fixture } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid=save-as-dialog-left]')).toBeFalsy();
    expect(root.querySelector('[data-testid=save-as-dialog-right]')).toBeFalsy();
    expect(root.querySelector('[data-testid=stale-dialog-left]')).toBeFalsy();
    expect(root.querySelector('[data-testid=stale-dialog-right]')).toBeFalsy();
    expect(root.querySelector('[data-testid=frame-badge]')).toBeFalsy();
  });

  it('loading a saved query on the left side updates left frame only; right frame and source-pickers untouched', async () => {
    const { fixture } = await setup(TWO, '/diff', {
      list: [{ slug: 'sample', hasParameters: false }],
      entries: {
        sample: {
          entry: { slug: 'sample', body: 'SELECT * { ?s ?p ?o }' },
          etag: 'e1',
        },
      },
    });
    const { left: leftPicker, right: rightPicker } = pickerStubs(fixture);
    const initialLeftSource = leftPicker.value;
    const initialRightSource = rightPicker.value;

    libraryStubs(fixture).left.load.emit('sample');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const { left: leftFrame, right: rightFrame } = frameStubs(fixture);
    expect(leftFrame.value).toBe('SELECT * { ?s ?p ?o }');
    expect(rightFrame.value).toBe('');
    expect(libraryStubs(fixture).left.selectedSlug).toBe('sample');
    expect(libraryStubs(fixture).right.selectedSlug).toBeNull();
    expect(pickerStubs(fixture).left.value).toBe(initialLeftSource);
    expect(pickerStubs(fixture).right.value).toBe(initialRightSource);
  });

  it('loading a saved query on the right side updates right frame only; left frame untouched', async () => {
    const { fixture } = await setup(TWO, '/diff', {
      list: [{ slug: 'sample', hasParameters: false }],
      entries: {
        sample: {
          entry: { slug: 'sample', body: 'ASK { ?s ?p ?o }' },
          etag: 'e1',
        },
      },
    });

    libraryStubs(fixture).right.load.emit('sample');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const { left: leftFrame, right: rightFrame } = frameStubs(fixture);
    expect(rightFrame.value).toBe('ASK { ?s ?p ?o }');
    expect(libraryStubs(fixture).right.selectedSlug).toBe('sample');
    expect(leftFrame.value).toBe('');
    expect(libraryStubs(fixture).left.selectedSlug).toBeNull();
  });

  it('selectedSlug clears on the side whose body diverges from its loadedBody', async () => {
    const { fixture } = await setup(TWO, '/diff', {
      list: [
        { slug: 'l', hasParameters: false },
        { slug: 'r', hasParameters: false },
      ],
      entries: {
        l: { entry: { slug: 'l', body: 'L' }, etag: 'el' },
        r: { entry: { slug: 'r', body: 'R' }, etag: 'er' },
      },
    });
    libraryStubs(fixture).left.load.emit('l');
    libraryStubs(fixture).right.load.emit('r');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(libraryStubs(fixture).left.selectedSlug).toBe('l');
    expect(libraryStubs(fixture).right.selectedSlug).toBe('r');

    frameStubs(fixture).left.valueChange.emit('L-modified');
    fixture.detectChanges();

    expect(libraryStubs(fixture).left.selectedSlug).toBeNull();
    expect(libraryStubs(fixture).right.selectedSlug).toBe('r');
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
        hunks: [
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

  it('discards the prior diff result when the user picks a different left source', async () => {
    const { fixture, diffStub } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    const { left, right } = pickerStubs(fixture);
    left.valueChange.emit('a');
    right.valueChange.emit('b');
    fixture.detectChanges();

    (root.querySelector('button[data-testid=run-diff]') as HTMLButtonElement).click();
    fixture.detectChanges();
    diffStub.calls[0].responses.next({
      kind: 'grouped',
      hunked: { hunks: [], totals: { left: 0, right: 0 } },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelector('[data-testid=diff-totals]')).toBeTruthy();

    left.valueChange.emit('b');
    fixture.detectChanges();

    expect(root.querySelector('[data-testid=diff-totals]')).toBeFalsy();
  });

  it('discards the prior diff errors when the user picks a different right source', async () => {
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
      errors: {
        left: { kind: 'legacy-message', message: 'left boom' },
        right: { kind: 'legacy-message', message: 'right boom' },
      },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelector('[data-testid=error-left]')).toBeTruthy();
    expect(root.querySelector('[data-testid=error-right]')).toBeTruthy();

    right.valueChange.emit('a');
    fixture.detectChanges();

    expect(root.querySelector('[data-testid=error-left]')).toBeFalsy();
    expect(root.querySelector('[data-testid=error-right]')).toBeFalsy();
    expect(root.querySelector('[data-testid=diff-totals]')).toBeFalsy();
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

  it('exposes an advanced disclosure with only the snippet context number input (default 3); the skipAutoSourceAnnotation checkbox is gone (ADR-0032)', async () => {
    const { fixture } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    const skip = root.querySelector(
      'input[data-testid=skip-auto-source-annotation]',
    );
    const ctx = root.querySelector(
      'input[data-testid=snippet-context]',
    ) as HTMLInputElement | null;
    expect(skip).toBeNull();
    expect(ctx).toBeTruthy();
    expect(ctx?.type).toBe('number');
    expect(ctx?.value).toBe('3');
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
        hunks: [
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

  it('renders a structured target/unknown-ref inline-error on the left panel when DiffService surfaces a transport-level 400', async () => {
    const { fixture, diffStub } = await setup(TWO);
    const root = fixture.nativeElement as HTMLElement;
    const { left, right } = pickerStubs(fixture);
    left.valueChange.emit('nope');
    right.valueChange.emit('b');
    fixture.detectChanges();

    (root.querySelector('button[data-testid=run-diff]') as HTMLButtonElement).click();
    fixture.detectChanges();

    diffStub.calls[0].responses.error({
      error: {
        kind: 'target',
        side: 'left',
        target: {
          kind: 'unknown-ref',
          ref: '@nope',
          availableIds: ['a', 'b'],
        },
      },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const leftPanel = root.querySelector(
      '[data-testid=error-left]',
    ) as HTMLElement | null;
    expect(leftPanel).toBeTruthy();
    expect(leftPanel?.textContent).toContain('@nope');
    expect(leftPanel?.textContent).toContain('@a');
    expect(leftPanel?.textContent).toContain('@b');
    expect(root.querySelector('[data-testid=error-right]')).toBeFalsy();
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
      errors: {
        left: { kind: 'legacy-message', message: 'left boom' },
        right: { kind: 'legacy-message', message: 'right boom' },
      },
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
