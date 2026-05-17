import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { LibraryPickerComponent } from '@app/modules/library-picker';
import { SourcesPickerComponent } from '@app/modules/sources-picker';
import { DiffPage } from './diff.page';
import { DiffHunkComponent } from './components/diff-hunk.component';
import { EditorFrameComponent } from '../query/components/editor-frame.component';
import { SourceSnippetComponent } from './components/source-snippet.component';
import {
  ConfigService,
  SavedQueriesService,
  type ConfigPayload,
  type DeleteResult,
  type LoadedSavedQuery,
  type PutResult,
  type SavedQueryEntry,
  type SavedQuerySummary,
  type SavedQueryWriteBody,
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
    @if (isModifiedFromLoaded()) {
      <span data-testid="frame-badge">modified from {{ loadedSlug }}</span>
    }
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
  @Input() loadedSlug?: string;
  @Input() loadedBody?: string;
  @Input() writable = true;
  @Input() loadError?: { kind: 'not-found'; slug: string };
  @Input() parameters?: ReadonlyArray<ParameterDeclaration>;
  @Input() initialBindings?: ParameterBindings;
  @Output() valueChange = new EventEmitter<string>();
  @Output() save = new EventEmitter<void>();
  @Output() saveAs = new EventEmitter<void>();
  // eslint-disable-next-line @angular-eslint/no-output-native
  @Output() delete = new EventEmitter<void>();
  @Output() submitBindings = new EventEmitter<ParameterBindings>();
  @Output() parametersDraftChange = new EventEmitter<
    ReadonlyArray<ParameterDeclaration>
  >();
  isModifiedFromLoaded(): boolean {
    return (
      this.loadedSlug !== undefined &&
      this.loadedBody !== undefined &&
      this.value !== this.loadedBody
    );
  }
}

@Component({
  selector: 'app-library-picker',
  standalone: true,
  template: `<ul data-testid="stub-library">
    @for (e of entries; track e.slug) {
      <li data-testid="stub-library-entry">{{ e.slug }}</li>
    }
  </ul>`,
})
class LibraryPickerStub {
  @Input() entries: readonly SavedQuerySummary[] = [];
  @Input() writable = true;
  // eslint-disable-next-line @angular-eslint/no-output-native
  @Output() load = new EventEmitter<string>();
  @Output() delete = new EventEmitter<string>();
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
  putBehavior?: (
    slug: string,
    body: SavedQueryWriteBody,
    ifMatch?: string,
  ) => PutResult;
  deleteBehavior?: (slug: string, ifMatch: string) => DeleteResult;
  calls: {
    list: number;
    get: Array<{ slug: string }>;
    put: Array<{ slug: string; body: SavedQueryWriteBody; ifMatch?: string }>;
    delete: Array<{ slug: string; ifMatch: string }>;
  };
}

function makeSavedQueriesStub(
  initial: Partial<SavedQueriesStubState> = {},
): {
  state: SavedQueriesStubState;
  service: Pick<SavedQueriesService, 'list' | 'get' | 'put' | 'delete'>;
} {
  const state: SavedQueriesStubState = {
    list: initial.list ?? [],
    entries: initial.entries ?? {},
    putBehavior: initial.putBehavior,
    deleteBehavior: initial.deleteBehavior,
    calls: { list: 0, get: [], put: [], delete: [] },
  };
  const service: Pick<SavedQueriesService, 'list' | 'get' | 'put' | 'delete'> = {
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
    put: (slug: string, body: SavedQueryWriteBody, ifMatch?: string) => {
      state.calls.put.push({ slug, body, ifMatch });
      const result: PutResult = state.putBehavior
        ? state.putBehavior(slug, body, ifMatch)
        : { kind: 'saved', etag: `etag-${slug}-${state.calls.put.length}` };
      if (result.kind === 'saved') {
        state.entries[slug] = {
          entry: { slug, body: body.body, description: body.description },
          etag: result.etag,
        };
        if (!state.list.some((e) => e.slug === slug)) {
          state.list = [...state.list, { slug, hasParameters: false }];
        }
      }
      return of(result);
    },
    delete: (slug: string, ifMatch: string) => {
      state.calls.delete.push({ slug, ifMatch });
      const result: DeleteResult = state.deleteBehavior
        ? state.deleteBehavior(slug, ifMatch)
        : { kind: 'deleted' };
      if (result.kind === 'deleted') {
        delete state.entries[slug];
        state.list = state.list.filter((e) => e.slug !== slug);
      }
      return of(result);
    },
  };
  return { state, service };
}

async function setup(
  listing: SourceListing,
  initialUrl = '/diff',
  savedQueries: Partial<SavedQueriesStubState> = {},
  capabilities: { writable?: boolean } = {},
) {
  const payload: ConfigPayload = {
    sources: listing.sources,
    context: { prefixes: {} },
    describe: {
      perSourceSoftLimit: 10000,
      perSourceHardLimit: 100000,
      fromSourcePredicate: 'urn:sparqly:fromSource',
    },
    savedQueries: { writable: capabilities.writable ?? true },
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
          LibraryPickerComponent,
        ],
      },
      add: {
        imports: [SourcesPickerStub, EditorFrameStub, LibraryPickerStub],
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

function libraryStub(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): LibraryPickerStub {
  const node = fixture.debugElement.query(
    (n) => n.componentInstance instanceof LibraryPickerStub,
  );
  if (!node) throw new Error('expected a library picker stub');
  return node.componentInstance as LibraryPickerStub;
}

function libraryStubs(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): { left: LibraryPickerStub; right: LibraryPickerStub } {
  const nodes = fixture.debugElement.queryAll(
    (n) => n.componentInstance instanceof LibraryPickerStub,
  );
  const lookup = (testid: string): LibraryPickerStub => {
    const found = nodes.find(
      (n) =>
        (n.nativeElement as HTMLElement).getAttribute('data-testid') === testid,
    );
    if (!found)
      throw new Error(
        `expected a library picker with data-testid=${testid}, got [${nodes
          .map(
            (n) =>
              (n.nativeElement as HTMLElement).getAttribute('data-testid') ?? '',
          )
          .join(', ')}]`,
      );
    return found.componentInstance as LibraryPickerStub;
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

  it('renders an EditorFrame per side with names "left" and "right", plus a shared LibraryPicker', async () => {
    const { fixture } = await setup(TWO, '/diff', {
      list: [{ slug: 'sample', hasParameters: false }],
    });
    const { left, right } = frameStubs(fixture);
    expect(left.name).toBe('left');
    expect(right.name).toBe('right');
    expect(libraryStub(fixture).entries.map((e) => e.slug)).toEqual(['sample']);
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
    expect(leftFrame.loadedSlug).toBe('sample');
    expect(leftFrame.loadedBody).toBe('SELECT * { ?s ?p ?o }');
    expect(rightFrame.value).toBe('');
    expect(rightFrame.loadedSlug).toBeUndefined();
    expect(rightFrame.loadedBody).toBeUndefined();
    expect(pickerStubs(fixture).left.value).toBe(initialLeftSource);
    expect(pickerStubs(fixture).right.value).toBe(initialRightSource);
  });

  it('Save on the left side PUTs with the left etag and updates left loadedBody+etag; right untouched', async () => {
    const { fixture, savedQueriesState } = await setup(TWO, '/diff', {
      list: [{ slug: 'sample', hasParameters: false }],
      entries: {
        sample: {
          entry: { slug: 'sample', body: 'SELECT * { ?a ?a ?a }' },
          etag: 'e1',
        },
      },
    });
    libraryStubs(fixture).left.load.emit('sample');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const { left: leftFrame, right: rightFrame } = frameStubs(fixture);
    leftFrame.valueChange.emit('SELECT * { ?b ?b ?b }');
    fixture.detectChanges();
    leftFrame.save.emit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(savedQueriesState.calls.put).toEqual([
      {
        slug: 'sample',
        body: { body: 'SELECT * { ?b ?b ?b }' },
        ifMatch: 'e1',
      },
    ]);

    const refreshed = frameStubs(fixture);
    expect(refreshed.left.loadedBody).toBe('SELECT * { ?b ?b ?b }');
    expect(refreshed.right.loadedSlug).toBeUndefined();
    expect(refreshed.right.loadedBody).toBeUndefined();
    // Right's query body is also untouched
    expect(rightFrame.value).toBe('');
  });

  it('Save on the right side PUTs with the right etag; left untouched', async () => {
    const { fixture, savedQueriesState } = await setup(TWO, '/diff', {
      list: [{ slug: 'sample', hasParameters: false }],
      entries: {
        sample: {
          entry: { slug: 'sample', body: 'A' },
          etag: 'e9',
        },
      },
    });
    libraryStubs(fixture).right.load.emit('sample');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const { right: rightFrame } = frameStubs(fixture);
    rightFrame.valueChange.emit('B');
    fixture.detectChanges();
    rightFrame.save.emit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(savedQueriesState.calls.put).toEqual([
      { slug: 'sample', body: { body: 'B' }, ifMatch: 'e9' },
    ]);
    const refreshed = frameStubs(fixture);
    expect(refreshed.right.loadedBody).toBe('B');
    expect(refreshed.left.loadedSlug).toBeUndefined();
  });

  it('Save-as on left opens left dialog; submitting PUTs a new slug and binds left only', async () => {
    const { fixture, savedQueriesState } = await setup(TWO);
    const { left: leftFrame, right: rightFrame } = frameStubs(fixture);
    leftFrame.valueChange.emit('SELECT * { ?l ?l ?l }');
    fixture.detectChanges();
    leftFrame.saveAs.emit();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const dialog = root.querySelector(
      '[data-testid=save-as-dialog-left]',
    ) as HTMLElement | null;
    expect(dialog).toBeTruthy();
    expect(
      root.querySelector('[data-testid=save-as-dialog-right]'),
    ).toBeFalsy();

    const slug = dialog!.querySelector(
      '[data-testid=save-as-slug-left]',
    ) as HTMLInputElement;
    slug.value = 'mine';
    slug.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      dialog!.querySelector(
        '[data-testid=save-as-submit-left]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(savedQueriesState.calls.put).toEqual([
      {
        slug: 'mine',
        body: { body: 'SELECT * { ?l ?l ?l }' },
        ifMatch: undefined,
      },
    ]);
    const refreshed = frameStubs(fixture);
    expect(refreshed.left.loadedSlug).toBe('mine');
    expect(refreshed.left.loadedBody).toBe('SELECT * { ?l ?l ?l }');
    expect(rightFrame.loadedSlug).toBeUndefined();
    // dialog closes after success
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid=save-as-dialog-left]',
      ),
    ).toBeFalsy();
  });

  it('Save-as on left with slug collision surfaces an inline error in the LEFT dialog only', async () => {
    const { fixture, savedQueriesState } = await setup(TWO, '/diff', {
      list: [{ slug: 'taken', hasParameters: false }],
      entries: {
        taken: { entry: { slug: 'taken', body: 'old' }, etag: 'e0' },
      },
    });
    savedQueriesState.putBehavior = () => ({ kind: 'slug-exists' });

    const { left: leftFrame } = frameStubs(fixture);
    leftFrame.valueChange.emit('X');
    leftFrame.saveAs.emit();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const slug = root.querySelector(
      '[data-testid=save-as-slug-left]',
    ) as HTMLInputElement;
    slug.value = 'taken';
    slug.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      root.querySelector(
        '[data-testid=save-as-submit-left]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const collision = root.querySelector(
      '[data-testid=save-as-collision-left]',
    );
    expect(collision?.textContent).toContain('taken');
    expect(root.querySelector('[data-testid=save-as-dialog-left]')).toBeTruthy();
    expect(
      root.querySelector('[data-testid=save-as-collision-right]'),
    ).toBeFalsy();
  });

  it('Save-as on right opens right dialog only and binds right on success', async () => {
    const { fixture, savedQueriesState } = await setup(TWO);
    const { right: rightFrame } = frameStubs(fixture);
    rightFrame.valueChange.emit('R');
    rightFrame.saveAs.emit();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[data-testid=save-as-dialog-left]'),
    ).toBeFalsy();
    const dialog = root.querySelector(
      '[data-testid=save-as-dialog-right]',
    ) as HTMLElement;
    expect(dialog).toBeTruthy();

    const slug = dialog.querySelector(
      '[data-testid=save-as-slug-right]',
    ) as HTMLInputElement;
    slug.value = 'r-mine';
    slug.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      dialog.querySelector(
        '[data-testid=save-as-submit-right]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(savedQueriesState.calls.put[0].slug).toBe('r-mine');
    expect(frameStubs(fixture).right.loadedSlug).toBe('r-mine');
    expect(frameStubs(fixture).left.loadedSlug).toBeUndefined();
  });

  it('Delete on left side DELETEs with left etag, clears left only, leaves right intact', async () => {
    const { fixture, savedQueriesState } = await setup(TWO, '/diff', {
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

    frameStubs(fixture).left.delete.emit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(savedQueriesState.calls.delete).toEqual([
      { slug: 'l', ifMatch: 'el' },
    ]);
    const refreshed = frameStubs(fixture);
    expect(refreshed.left.loadedSlug).toBeUndefined();
    expect(refreshed.right.loadedSlug).toBe('r');
    expect(refreshed.right.loadedBody).toBe('R');
  });

  it('Library Delete clears the slug from both sides if loaded; refreshes library', async () => {
    const { fixture, savedQueriesState } = await setup(TWO, '/diff', {
      list: [{ slug: 'shared', hasParameters: false }],
      entries: {
        shared: { entry: { slug: 'shared', body: 'S' }, etag: 'es' },
      },
    });
    libraryStubs(fixture).left.load.emit('shared');
    libraryStubs(fixture).right.load.emit('shared');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    libraryStubs(fixture).left.delete.emit('shared');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(savedQueriesState.calls.delete.length).toBe(1);
    expect(savedQueriesState.list.map((e) => e.slug)).toEqual([]);
    const refreshed = frameStubs(fixture);
    expect(refreshed.left.loadedSlug).toBeUndefined();
    expect(refreshed.right.loadedSlug).toBeUndefined();
  });

  it('412 stale on left Save shows left stale dialog only; Reload refreshes left from server', async () => {
    let stale = true;
    const { fixture, savedQueriesState } = await setup(TWO, '/diff', {
      list: [{ slug: 's', hasParameters: false }],
      entries: { s: { entry: { slug: 's', body: 'OLD' }, etag: 'e1' } },
    });
    savedQueriesState.putBehavior = () => {
      if (stale) {
        stale = false;
        return { kind: 'stale' };
      }
      return { kind: 'saved', etag: 'eN' };
    };
    libraryStubs(fixture).left.load.emit('s');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    frameStubs(fixture).left.valueChange.emit('NEW');
    fixture.detectChanges();
    frameStubs(fixture).left.save.emit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid=stale-dialog-left]')).toBeTruthy();
    expect(root.querySelector('[data-testid=stale-dialog-right]')).toBeFalsy();

    // Server-side state moves on: someone else updated 's'
    savedQueriesState.entries['s'] = {
      entry: { slug: 's', body: 'SERVER' },
      etag: 'eServer',
    };

    (
      root.querySelector(
        '[data-testid=stale-reload-left]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const refreshed = frameStubs(fixture);
    expect(refreshed.left.value).toBe('SERVER');
    expect(refreshed.left.loadedBody).toBe('SERVER');
    expect(root.querySelector('[data-testid=stale-dialog-left]')).toBeFalsy();
  });

  it('412 stale on left Save → Overwrite re-fetches etag and re-PUTs successfully', async () => {
    let stale = true;
    const { fixture, savedQueriesState } = await setup(TWO, '/diff', {
      list: [{ slug: 's', hasParameters: false }],
      entries: { s: { entry: { slug: 's', body: 'OLD' }, etag: 'e1' } },
    });
    savedQueriesState.putBehavior = () => {
      if (stale) {
        stale = false;
        return { kind: 'stale' };
      }
      return { kind: 'saved', etag: 'eOverwrite' };
    };
    libraryStubs(fixture).left.load.emit('s');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    frameStubs(fixture).left.valueChange.emit('NEW');
    frameStubs(fixture).left.save.emit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Server state moves to a new etag
    savedQueriesState.entries['s'] = {
      entry: { slug: 's', body: 'OLD' },
      etag: 'eServer',
    };

    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector(
        '[data-testid=stale-overwrite-left]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(savedQueriesState.calls.put.length).toBe(2);
    expect(savedQueriesState.calls.put[1].ifMatch).toBe('eServer');
    expect(root.querySelector('[data-testid=stale-dialog-left]')).toBeFalsy();
    expect(frameStubs(fixture).left.loadedBody).toBe('NEW');
  });

  it('412 stale on right Save shows right stale dialog only; left untouched', async () => {
    let stale = true;
    const { fixture, savedQueriesState } = await setup(TWO, '/diff', {
      list: [{ slug: 's', hasParameters: false }],
      entries: { s: { entry: { slug: 's', body: 'OLD' }, etag: 'e1' } },
    });
    savedQueriesState.putBehavior = () => {
      if (stale) {
        stale = false;
        return { kind: 'stale' };
      }
      return { kind: 'saved', etag: 'eN' };
    };
    libraryStubs(fixture).right.load.emit('s');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    frameStubs(fixture).right.valueChange.emit('NEW');
    frameStubs(fixture).right.save.emit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid=stale-dialog-right]')).toBeTruthy();
    expect(root.querySelector('[data-testid=stale-dialog-left]')).toBeFalsy();
  });

  it('"modified from" badge appears only on the side whose body diverges from its loadedBody', async () => {
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

    frameStubs(fixture).left.valueChange.emit('L-modified');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[data-testid=frame-left] [data-testid=frame-badge]'),
    ).toBeTruthy();
    expect(
      root.querySelector('[data-testid=frame-right] [data-testid=frame-badge]'),
    ).toBeFalsy();
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
    expect(rightFrame.loadedSlug).toBe('sample');
    expect(leftFrame.value).toBe('');
    expect(leftFrame.loadedSlug).toBeUndefined();
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
