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
import { SourcesPickerComponent } from '@app/modules/sources-picker';
import {
  ConfigService,
  type DisplayContext,
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
import { YasqeEditorComponent } from '@app/modules/yasqe-editor';
import { DiffResultRendererComponent } from './components/diff-result-renderer.component';

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
    YasqeEditorComponent,
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
            <div class="flex h-80 min-h-32 resize-y flex-col overflow-hidden rounded-lg border border-border bg-surface">
              <app-yasqe-editor
                class="min-h-0 flex-1"
                data-testid="editor-left"
                [value]="leftQuery()"
                (valueChange)="leftQuery.set($event)"
              />
            </div>

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
            <div class="flex h-80 min-h-32 resize-y flex-col overflow-hidden rounded-lg border border-border bg-surface">
              <app-yasqe-editor
                class="min-h-0 flex-1"
                data-testid="editor-right"
                [value]="rightQuery()"
                (valueChange)="rightQuery.set($event)"
              />
            </div>

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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly sources = signal<SourceListingEntry[] | null>(null);
  readonly leftId = signal<string>('');
  readonly rightId = signal<string>('');
  readonly leftQuery = signal<string>('');
  readonly rightQuery = signal<string>('');
  readonly running = signal<boolean>(false);
  readonly result = signal<DiffResponse | null>(null);
  readonly errors = signal<DiffErrorResponse['errors'] | null>(null);
  readonly context = signal<number>(3);
  readonly displayContext = signal<DisplayContext>({ prefixes: {} });

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
    if (leftQuery !== null) this.leftQuery.set(leftQuery);
    if (rightQuery !== null) this.rightQuery.set(rightQuery);

    effect(() => {
      const queryParams: Record<string, string | null> = {
        left: this.leftId() || null,
        right: this.rightId() || null,
        leftQuery: this.leftQuery() || null,
        rightQuery: this.rightQuery() || null,
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
      const def = config.sources.find((s) => s.default === true);
      const initial = def?.id ?? config.sources[0]?.id ?? '';
      if (initial !== '') {
        if (this.leftId() === '') this.leftId.set(initial);
        if (this.rightId() === '') this.rightId.set(initial);
      }
    });
  }

  run(): void {
    this.running.set(true);
    this.result.set(null);
    this.errors.set(null);
    const req: DiffRequest = {
      left: this.leftId(),
      right: this.rightId(),
      leftQuery: this.leftQuery(),
      rightQuery: this.rightQuery(),
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
