import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SourcesPickerComponent } from '@app/modules/sources-picker';
import {
  ConfigService,
  type DisplayContext,
  type SourceListingEntry,
} from '@app/core';
import {
  DiffService,
  type DiffErrorResponse,
  type DiffRequest,
  type DiffResponse,
} from './diff.service';
import { YasqeEditorComponent } from '@app/modules/yasqe-editor';
import { DiffResultRenderer } from './diff-result-renderer';

@Component({
  selector: 'app-diff-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SourcesPickerComponent, DiffResultRenderer, YasqeEditorComponent],
  template: `
    @if (sources() === null) {
      <main class="p-4 text-sm text-foreground-faint">loading…</main>
    } @else if ((sources() ?? []).length <= 1) {
      <main data-testid="empty-state" class="p-4 text-sm text-foreground-muted">
        <p>
          <code class="rounded bg-surface-sunken px-1 py-0.5 font-mono">/diff</code> needs at
          least two registered sources.
        </p>
        <p class="text-foreground-faint">
          You're running <strong>serve</strong> in single-source mode (or with
          an empty registry); diffing is unavailable. Restart
          <code class="rounded bg-surface-sunken px-1 py-0.5 font-mono">sparqly serve</code>
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
              (valueChange)="leftId.set($event)"
            />
            <app-yasqe-editor
              data-testid="editor-left"
              [value]="leftQuery()"
              (valueChange)="leftQuery.set($event)"
            />

            @if (errors()?.left) {
              <p
                data-testid="error-left"
                class="rounded border border-error-line bg-error-bg p-2 text-sm text-error"
              >
                {{ errors()?.left }}
              </p>
            }
          </div>
          <div class="flex flex-col gap-2">
            <app-sources-picker
              label="right"
              [value]="rightId()"
              (valueChange)="rightId.set($event)"
            />
            <app-yasqe-editor
              data-testid="editor-right"
              [value]="rightQuery()"
              (valueChange)="rightQuery.set($event)"
            />

            @if (errors()?.right) {
              <p
                data-testid="error-right"
                class="rounded border border-error-line bg-error-bg p-2 text-sm text-error"
              >
                {{ errors()?.right }}
              </p>
            }
          </div>
        </section>
        @if (errors()?.top) {
          <p
            data-testid="error-top"
            class="rounded border border-error-line bg-error-bg p-2 text-sm text-error"
          >
            {{ errors()?.top }}
          </p>
        }
        <details class="rounded border border-border-muted bg-surface p-2 text-sm">
          <summary class="cursor-pointer select-none text-foreground-muted">
            Advanced
          </summary>
          <div class="mt-2 flex flex-col gap-2">
            <label class="flex items-center gap-2">
              <input
                data-testid="skip-auto-source-annotation"
                type="checkbox"
                [checked]="skipAutoSourceAnnotation()"
                (change)="skipAutoSourceAnnotation.set($any($event.target).checked)"
              />
              <span>Skip auto source annotation</span>
            </label>
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
            data-testid="run-diff"
            type="button"
            class="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground shadow-sm transition-colors hover:bg-accent-strong disabled:opacity-50"
            [disabled]="running()"
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
  readonly skipAutoSourceAnnotation = signal<boolean>(false);
  readonly displayContext = signal<DisplayContext>({ prefixes: {} });

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
    if (this.skipAutoSourceAnnotation()) req.skipAutoSourceAnnotation = true;
    this.diffService
      .run(req)
      .subscribe({
        next: (res) => {
          this.running.set(false);
          this.result.set(res);
          if (res.kind === 'error') this.errors.set(res.errors);
        },
        error: (err: { error?: DiffErrorResponse; message?: string }) => {
          this.running.set(false);
          if (err?.error?.kind === 'error') {
            this.errors.set(err.error.errors);
            this.result.set(err.error);
          } else {
            this.errors.set({ top: err?.message ?? 'request failed' });
          }
        },
      });
  }
}
