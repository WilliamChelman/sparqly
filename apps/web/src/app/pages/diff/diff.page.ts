import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@app/modules/button';
import { CodeChipComponent } from '@app/modules/code-chip';
import { ErrorBannerComponent } from '@app/modules/error-banner';
import { LibraryPickerComponent } from '@app/modules/library-picker';
import { SourcesPickerComponent } from '@app/modules/sources-picker';
import {
  ConfigService,
  SavedQueriesService,
  type DisplayContext,
  type SavedQuerySummary,
  type SourceListingEntry,
} from '@app/core';
import {
  DiffService,
  formatDiffError,
  type DiffError,
  type DiffErrorResponse,
  type DiffRequest,
  type DiffResponse,
} from './services/diff.service';
import { EditorFrameComponent } from '../query/components/editor-frame.component';
import { DiffResultRendererComponent } from './components/diff-result-renderer.component';
import { EditorFrameController } from './editor-frame-controller';

@Component({
  selector: 'app-diff-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    CodeChipComponent,
    ErrorBannerComponent,
    SourcesPickerComponent,
    DiffResultRendererComponent,
    EditorFrameComponent,
    LibraryPickerComponent,
  ],
  template: `
    @if (sources() === null) {
      <main class="p-4 text-sm text-foreground-faint">loading…</main>
    } @else if ((sources() ?? []).length <= 1) {
      <main data-testid="empty-state" class="p-4 text-sm text-foreground-muted">
        <p>
          <code app-code-chip>/diff</code> needs at
          least two registered sources.
        </p>
        <p class="text-foreground-faint">
          You're running <strong>serve</strong> in single-source mode (or with
          an empty registry); diffing is unavailable. Restart
          <code app-code-chip>sparqly serve</code>
          without a positional/<code>--source</code> flag, against a config
          that declares two or more sources, to enable this page.
        </p>
      </main>
    } @else {
      <main class="flex flex-col gap-4 p-4">
        <section class="grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-2">
            <app-sources-picker
              label="left"
              [value]="leftId()"
              (valueChange)="onLeftIdChange($event)"
            />
            <app-editor-frame
              data-testid="editor-left"
              name="left"
              [value]="leftSide.query()"
              [loadedSlug]="leftSide.loadedSlug() ?? undefined"
              [loadedBody]="leftSide.loadedBody() ?? undefined"
              [loadError]="leftSide.loadError() ?? undefined"
              [parameters]="leftSide.loadedParameters() ?? undefined"
              [writable]="writable()"
              (valueChange)="leftSide.query.set($event)"
              (save)="leftSide.save()"
              (saveAs)="leftSide.openSaveAs()"
              (delete)="leftSide.delete()"
            />
            <app-library-picker
              data-testid="library-left"
              [entries]="savedQueries()"
              [writable]="writable()"
              (load)="leftSide.load($event)"
              (delete)="onLibraryDelete($event)"
            />
            @if (leftSide.staleConflict(); as staleSlug) {
              <div
                data-testid="stale-dialog-left"
                role="dialog"
                class="rounded border border-warning bg-surface p-3 text-sm"
              >
                <p>
                  <strong>{{ staleSlug }}</strong> was changed elsewhere.
                  Reload to see the current version, or overwrite.
                </p>
                <div class="mt-2 flex gap-2">
                  <button
                    app-btn
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="stale-reload-left"
                    (click)="leftSide.staleReload()"
                  >
                    Reload
                  </button>
                  <button
                    app-btn
                    type="button"
                    variant="primary"
                    size="sm"
                    data-testid="stale-overwrite-left"
                    (click)="leftSide.staleOverwrite()"
                  >
                    Overwrite
                  </button>
                </div>
              </div>
            }
            @if (leftSide.saveAsOpen()) {
              <div
                data-testid="save-as-dialog-left"
                role="dialog"
                class="flex flex-col gap-2 rounded border border-border-muted bg-surface p-3 text-sm"
              >
                <label class="flex flex-col gap-1">
                  <span class="text-foreground-muted">Save as (slug):</span>
                  <input
                    type="text"
                    data-testid="save-as-slug-left"
                    [value]="leftSide.saveAsSlug()"
                    (input)="leftSide.setSaveAsSlug($any($event.target).value)"
                  />
                </label>
                @if (leftSide.saveAsError(); as err) {
                  <p data-testid="save-as-collision-left" class="text-danger">
                    {{ err }}
                  </p>
                }
                <div class="flex gap-2">
                  <button
                    app-btn
                    type="button"
                    variant="primary"
                    size="sm"
                    data-testid="save-as-submit-left"
                    (click)="leftSide.submitSaveAs()"
                  >
                    Save
                  </button>
                  <button
                    app-btn
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="save-as-cancel-left"
                    (click)="leftSide.closeSaveAs()"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            }

            @if (errors()?.left; as left) {
              <p app-error-banner data-testid="error-left">
                {{ format(left) }}
              </p>
            }
          </div>
          <div class="flex flex-col gap-2">
            <app-sources-picker
              label="right"
              [value]="rightId()"
              (valueChange)="onRightIdChange($event)"
            />
            <app-editor-frame
              data-testid="editor-right"
              name="right"
              [value]="rightSide.query()"
              [loadedSlug]="rightSide.loadedSlug() ?? undefined"
              [loadedBody]="rightSide.loadedBody() ?? undefined"
              [loadError]="rightSide.loadError() ?? undefined"
              [parameters]="rightSide.loadedParameters() ?? undefined"
              [writable]="writable()"
              (valueChange)="rightSide.query.set($event)"
              (save)="rightSide.save()"
              (saveAs)="rightSide.openSaveAs()"
              (delete)="rightSide.delete()"
            />
            <app-library-picker
              data-testid="library-right"
              [entries]="savedQueries()"
              [writable]="writable()"
              (load)="rightSide.load($event)"
              (delete)="onLibraryDelete($event)"
            />
            @if (rightSide.staleConflict(); as staleSlug) {
              <div
                data-testid="stale-dialog-right"
                role="dialog"
                class="rounded border border-warning bg-surface p-3 text-sm"
              >
                <p>
                  <strong>{{ staleSlug }}</strong> was changed elsewhere.
                  Reload to see the current version, or overwrite.
                </p>
                <div class="mt-2 flex gap-2">
                  <button
                    app-btn
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="stale-reload-right"
                    (click)="rightSide.staleReload()"
                  >
                    Reload
                  </button>
                  <button
                    app-btn
                    type="button"
                    variant="primary"
                    size="sm"
                    data-testid="stale-overwrite-right"
                    (click)="rightSide.staleOverwrite()"
                  >
                    Overwrite
                  </button>
                </div>
              </div>
            }
            @if (rightSide.saveAsOpen()) {
              <div
                data-testid="save-as-dialog-right"
                role="dialog"
                class="flex flex-col gap-2 rounded border border-border-muted bg-surface p-3 text-sm"
              >
                <label class="flex flex-col gap-1">
                  <span class="text-foreground-muted">Save as (slug):</span>
                  <input
                    type="text"
                    data-testid="save-as-slug-right"
                    [value]="rightSide.saveAsSlug()"
                    (input)="rightSide.setSaveAsSlug($any($event.target).value)"
                  />
                </label>
                @if (rightSide.saveAsError(); as err) {
                  <p data-testid="save-as-collision-right" class="text-danger">
                    {{ err }}
                  </p>
                }
                <div class="flex gap-2">
                  <button
                    app-btn
                    type="button"
                    variant="primary"
                    size="sm"
                    data-testid="save-as-submit-right"
                    (click)="rightSide.submitSaveAs()"
                  >
                    Save
                  </button>
                  <button
                    app-btn
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="save-as-cancel-right"
                    (click)="rightSide.closeSaveAs()"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            }

            @if (errors()?.right; as right) {
              <p app-error-banner data-testid="error-right">
                {{ format(right) }}
              </p>
            }
          </div>
        </section>
        @if (errors()?.top; as top) {
          <p app-error-banner data-testid="error-top">
            {{ format(top) }}
          </p>
        }
        <details class="rounded border border-border-muted bg-surface p-2 text-sm">
          <summary class="cursor-pointer select-none text-foreground-muted">
            Advanced
          </summary>
          <div class="mt-2 flex flex-col gap-2">
            <label class="flex items-center gap-2">
              <span>Snippet context lines</span>
              <input
                data-testid="snippet-context"
                type="number"
                min="0"
                max="100"
                class="w-20 rounded border border-border bg-surface px-1 py-0.5 text-foreground"
                [value]="context()"
                (input)="setContext($any($event.target).value)"
              />
            </label>
          </div>
        </details>
        <div>
          <button
            app-btn
            variant="primary"
            data-testid="run-diff"
            type="button"
            [loading]="running()"
            (click)="run()"
          >
            {{ running() ? 'running…' : 'Run' }}
          </button>
        </div>
        @if (result(); as r) {
          <app-diff-result-renderer
            [result]="r"
            [context]="context()"
            [displayContext]="displayContext()"
          />
        }
      </main>
    }
  `,
})
export class DiffPage implements OnInit {
  private readonly configService = inject(ConfigService);
  private readonly diffService = inject(DiffService);
  private readonly savedQueriesService = inject(SavedQueriesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly sources = signal<SourceListingEntry[] | null>(null);
  readonly leftId = signal<string>('');
  readonly rightId = signal<string>('');
  readonly leftSide = new EditorFrameController(
    this.savedQueriesService,
    () => this.refreshLibrary(),
  );
  readonly rightSide = new EditorFrameController(
    this.savedQueriesService,
    () => this.refreshLibrary(),
  );
  readonly running = signal<boolean>(false);
  readonly result = signal<DiffResponse | null>(null);
  readonly errors = signal<DiffErrorResponse['errors'] | null>(null);
  readonly context = signal<number>(3);
  readonly displayContext = signal<DisplayContext>({ prefixes: {} });
  readonly savedQueries = signal<readonly SavedQuerySummary[]>([]);
  readonly writable = signal<boolean>(true);

  format(error: DiffError): string {
    return formatDiffError(error);
  }

  constructor() {
    const params = this.route.snapshot.queryParamMap;
    const left = params.get('left');
    const right = params.get('right');
    const leftQuery = params.get('leftQuery');
    const rightQuery = params.get('rightQuery');
    if (left) this.leftId.set(left);
    if (right) this.rightId.set(right);
    if (leftQuery !== null) this.leftSide.query.set(leftQuery);
    if (rightQuery !== null) this.rightSide.query.set(rightQuery);

    effect(() => {
      const queryParams: Record<string, string | null> = {
        left: this.leftId() || null,
        right: this.rightId() || null,
        leftQuery: this.leftSide.query() || null,
        rightQuery: this.rightSide.query() || null,
      };
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams,
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
  }

  onLeftIdChange(id: string): void {
    if (id === this.leftId()) return;
    this.leftId.set(id);
    this.result.set(null);
    this.errors.set(null);
  }

  onRightIdChange(id: string): void {
    if (id === this.rightId()) return;
    this.rightId.set(id);
    this.result.set(null);
    this.errors.set(null);
  }

  setContext(raw: string): void {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) this.context.set(n);
  }

  ngOnInit(): void {
    this.configService.config().subscribe((config) => {
      this.sources.set(config.sources);
      this.displayContext.set(config.context);
      this.writable.set(config.savedQueries?.writable ?? true);
      const def = config.sources.find((s) => s.default === true);
      const initial = def?.id ?? config.sources[0]?.id ?? '';
      if (initial !== '') {
        if (this.leftId() === '') this.leftId.set(initial);
        if (this.rightId() === '') this.rightId.set(initial);
      }
    });
    this.refreshLibrary();
  }

  private refreshLibrary(): void {
    this.savedQueriesService.list().subscribe((entries) => {
      this.savedQueries.set(entries);
    });
  }

  onLibraryDelete(slug: string): void {
    this.savedQueriesService.get(slug).subscribe((loaded) => {
      this.savedQueriesService.delete(slug, loaded.etag).subscribe((result) => {
        if (result.kind === 'deleted') {
          this.leftSide.clearIfMatches(slug);
          this.rightSide.clearIfMatches(slug);
          this.refreshLibrary();
        }
      });
    });
  }

  run(): void {
    this.running.set(true);
    this.result.set(null);
    this.errors.set(null);
    const req: DiffRequest = {
      left: this.leftId(),
      right: this.rightId(),
      leftQuery: this.leftSide.query(),
      rightQuery: this.rightSide.query(),
    };
    this.diffService
      .run(req)
      .subscribe({
        next: (res) => {
          this.running.set(false);
          this.result.set(res);
          if (res.kind === 'error') this.errors.set(res.errors);
        },
        error: (
          err: {
            error?: DiffErrorResponse | DiffError;
            message?: string;
          },
        ) => {
          this.running.set(false);
          const body = err?.error;
          if (body !== undefined && 'kind' in body && body.kind === 'error') {
            this.errors.set(body.errors);
            this.result.set(body);
            return;
          }
          if (
            body !== undefined &&
            'kind' in body &&
            body.kind === 'target'
          ) {
            // Transport-level TargetWrappedError (e.g. unknown @id): unwrap into
            // the matching side slot so the inline-error renderer dispatches on
            // `target.kind` (ADR-0024 wrap-don't-duplicate).
            const errors: DiffErrorResponse['errors'] =
              body.side === 'left' ? { left: body } : { right: body };
            this.errors.set(errors);
            this.result.set({ kind: 'error', errors });
            return;
          }
          this.errors.set({
            top: { kind: 'legacy-message', message: err?.message ?? 'request failed' },
          });
        },
      });
  }
}
