import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  Input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  SavedQueriesService,
  type LoadedSavedQuery,
  type SavedQueryWriteBody,
} from '@app/core';
import { ButtonComponent } from '@app/modules/button';
import { SourcesPickerComponent } from '@app/modules/sources-picker';
import { YasqeEditorComponent } from '@app/modules/yasqe-editor';
import {
  substitute,
  type ParameterBindings,
  type ParameterDeclaration,
} from 'common';
import { ParameterEditorComponent } from '../query/components/parameter-editor.component';
import { ParameterFormComponent } from '../query/components/parameter-form.component';
import {
  ResultPaneComponent,
  type ResultPaneState,
} from '../query/components/result/result-pane.component';
import { parametersEqual, toWriteBody } from './queries-detail-state';
import { DeleteController } from './queries-delete-controller';
import { QueriesStaleDeleteDialogComponent } from './queries-stale-delete-dialog.component';
import { QueriesStaleDialogComponent } from './queries-stale-dialog.component';
import { runSparql } from './utils/run-sparql';

export interface LoadedDetailInput {
  readonly slug: string;
  readonly body: string;
  readonly etag: string;
  readonly parameters: ReadonlyArray<ParameterDeclaration>;
}

@Component({
  selector: 'app-queries-loaded-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    SourcesPickerComponent,
    YasqeEditorComponent,
    ParameterEditorComponent,
    ParameterFormComponent,
    ResultPaneComponent,
    QueriesStaleDialogComponent,
    QueriesStaleDeleteDialogComponent,
  ],
  template: `
    <div class="flex items-center justify-between">
      <h2
        class="font-mono text-sm text-foreground"
        data-testid="queries-detail-slug"
      >
        {{ loadedSlug() }}
      </h2>
      @if (isModifiedFromLoaded()) {
        <span
          data-testid="queries-modified-badge"
          class="font-mono text-xs text-warning"
        >
          modified from <code>{{ loadedSlug() }}</code>
        </span>
      }
    </div>
    @if (writable) {
      <app-yasqe-editor
        class="mt-2 block"
        [value]="draftBody()"
        (valueChange)="onBodyChange($event)"
      />
    } @else {
      <pre
        data-testid="queries-body-readonly"
        class="mt-2 block overflow-auto rounded border border-border-muted bg-surface p-2 font-mono text-sm text-foreground"
      >{{ draftBody() }}</pre>
    }
    @if (writable) {
      <div class="mt-3">
        <app-parameter-editor
          [parameters]="draftParameters()"
          [body]="draftBody()"
          (parametersChange)="onParametersDraftChange($event)"
        />
      </div>
    }
    <div class="mt-3 flex flex-col gap-3">
      <div
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-muted bg-surface p-3 shadow-sm"
      >
        <app-sources-picker
          label="source"
          [value]="sourceId"
          (valueChange)="sourceChange.emit($event)"
        />
        <div class="flex flex-wrap items-center gap-2">
          @if (writable) {
            <button
              app-btn
              type="button"
              variant="accent"
              data-testid="queries-save"
              (click)="onSave()"
            >
              Save
            </button>
            <button
              app-btn
              type="button"
              variant="secondary"
              data-testid="queries-save-as"
              (click)="onSaveAs()"
            >
              Save as…
            </button>
            <button
              app-btn
              type="button"
              variant="danger"
              data-testid="queries-delete"
              (click)="onDelete()"
            >
              Delete
            </button>
            <span
              class="mx-1 h-5 w-px bg-border-muted"
              aria-hidden="true"
            ></span>
          }
          <button
            app-btn
            type="button"
            variant="primary"
            data-testid="queries-run"
            [disabled]="!sourceId"
            (click)="onRun()"
          >
            Run
          </button>
        </div>
      </div>
      @if (staleConflict(); as slug) {
        <app-queries-stale-dialog
          [slug]="slug"
          (reload)="onStaleReload()"
          (overwrite)="onStaleOverwrite()"
        />
      }
      @if (deleteController.staleConflict(); as slug) {
        <app-queries-stale-delete-dialog
          [slug]="slug"
          (reload)="deleteController.reload()"
          (confirmDelete)="deleteController.confirmAfterStale()"
        />
      }
      @if (hasDraftParameters()) {
        <app-parameter-form
          [parameters]="draftParameters()"
          (submitBindings)="onSubmitBindings($event)"
        />
      }
      <app-result-pane [state]="resultState()" />
    </div>
  `,
})
export class QueriesLoadedDetailComponent {
  private readonly service = inject(SavedQueriesService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly loadedSlug = signal<string>('');
  readonly currentEtag = signal<string>('');
  readonly currentBody = signal<string>('');
  readonly currentParameters = signal<ReadonlyArray<ParameterDeclaration>>([]);
  readonly draftBody = signal<string>('');
  readonly draftParameters = signal<ReadonlyArray<ParameterDeclaration>>([]);
  readonly resultState = signal<ResultPaneState>({ kind: 'empty' });
  readonly staleConflict = signal<string | null>(null);

  @Input() writable = true;

  private _sourceId = '';
  @Input()
  set sourceId(value: string) {
    if (value === this._sourceId) return;
    this._sourceId = value;
    this.resultState.set({ kind: 'empty' });
  }
  get sourceId(): string {
    return this._sourceId;
  }

  @Input({ required: true })
  set loaded(value: LoadedDetailInput) {
    const slugChanged = value.slug !== this.loadedSlug();
    this.loadedSlug.set(value.slug);
    this.currentEtag.set(value.etag);
    this.currentBody.set(value.body);
    this.currentParameters.set(value.parameters);
    this.draftBody.set(value.body);
    this.draftParameters.set(value.parameters);
    if (slugChanged) this.resultState.set({ kind: 'empty' });
    this.staleConflict.set(null);
  }

  readonly sourceChange = output<string>();
  readonly saved = output<void>();
  readonly deleted = output<void>();

  readonly deleteController = new DeleteController({
    service: this.service,
    router: this.router,
    applyLoaded: (loaded: LoadedSavedQuery) =>
      this.applyLoadedFromServer(loaded),
    onDeleted: () => this.deleted.emit(),
  });

  readonly isModifiedFromLoaded = computed(() => {
    if (this.draftBody() !== this.currentBody()) return true;
    return !parametersEqual(this.draftParameters(), this.currentParameters());
  });

  readonly hasDraftParameters = computed(
    () => this.draftParameters().length > 0,
  );

  onBodyChange(value: string): void {
    this.draftBody.set(value);
  }

  onParametersDraftChange(
    parameters: ReadonlyArray<ParameterDeclaration>,
  ): void {
    this.draftParameters.set(parameters);
  }

  onSave(): void {
    const slug = this.loadedSlug();
    const writeBody = this.buildWriteBody();
    this.service
      .put(slug, writeBody, this.currentEtag())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result.kind === 'saved') {
          this.applyAfterSave(writeBody, result.etag);
        } else if (result.kind === 'stale') {
          this.staleConflict.set(slug);
        }
      });
  }

  onSaveAs(): void {
    void this.router.navigate(['/queries', 'new'], {
      state: {
        prefill: {
          body: this.draftBody(),
          parameters: this.draftParameters(),
        },
        origin: this.loadedSlug(),
      },
    });
  }

  onDelete(): void {
    this.deleteController.start(this.loadedSlug(), this.currentEtag());
  }

  onStaleReload(): void {
    const slug = this.staleConflict();
    if (slug === null) return;
    this.service
      .get(slug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((loaded) => {
        this.staleConflict.set(null);
        this.applyLoadedFromServer(loaded);
      });
  }

  onStaleOverwrite(): void {
    const slug = this.staleConflict();
    if (slug === null) return;
    this.service
      .get(slug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((loaded) => {
        const writeBody = this.buildWriteBody();
        this.service
          .put(slug, writeBody, loaded.etag)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((result) => {
            if (result.kind === 'saved') {
              this.applyAfterSave(writeBody, result.etag);
              this.staleConflict.set(null);
            }
          });
      });
  }

  onRun(): void {
    if (!this.sourceId) return;
    this.executeSparql(this.draftBody());
  }

  onSubmitBindings(bindings: ParameterBindings): void {
    if (!this.sourceId) return;
    const result = substitute(
      { body: this.draftBody(), parameters: this.draftParameters() },
      bindings,
    );
    if (result.isErr()) return;
    this.executeSparql(result.value);
  }

  private applyLoadedFromServer(loaded: LoadedSavedQuery): void {
    const parameters = loaded.entry.parameters ?? [];
    this.currentEtag.set(loaded.etag);
    this.currentBody.set(loaded.entry.body);
    this.currentParameters.set(parameters);
    this.draftBody.set(loaded.entry.body);
    this.draftParameters.set(parameters);
  }

  private applyAfterSave(writeBody: SavedQueryWriteBody, etag: string): void {
    this.currentEtag.set(etag);
    this.currentBody.set(writeBody.body);
    this.currentParameters.set(writeBody.parameters ?? []);
    this.saved.emit();
  }

  private buildWriteBody(): SavedQueryWriteBody {
    return toWriteBody(this.draftBody(), this.draftParameters());
  }

  private executeSparql(sparql: string): void {
    this.resultState.set({ kind: 'loading' });
    runSparql(this.http, this.sourceId, sparql)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => this.resultState.set(state));
  }
}
