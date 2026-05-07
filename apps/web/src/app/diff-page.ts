import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  SourcesPicker,
} from './sources-picker';
import {
  ConfigService,
  type DisplayContext,
  type SourceListingEntry,
} from './config.service';
import {
  DiffService,
  type DiffErrorResponse,
  type DiffRequest,
  type DiffResponse,
} from './diff.service';
import { DiffResultRenderer } from './diff-result-renderer';
import { YasqeEditor } from './yasqe-editor';

@Component({
  selector: 'app-diff-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SourcesPicker, DiffResultRenderer, YasqeEditor],
  template: `
    @if (sources() === null) {
      <main class="p-4 text-sm text-slate-500">loading…</main>
    } @else if ((sources() ?? []).length <= 1) {
      <main data-testid="empty-state" class="p-4 text-sm text-slate-700">
        <p>
          <code class="rounded bg-slate-100 px-1 py-0.5">/diff</code> needs at
          least two registered sources.
        </p>
        <p class="text-slate-500">
          You're running <strong>serve</strong> in single-source mode (or with
          an empty registry); diffing is unavailable. Restart
          <code class="rounded bg-slate-100 px-1 py-0.5">sparqly serve</code>
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
                class="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700"
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
                class="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700"
              >
                {{ errors()?.right }}
              </p>
            }
          </div>
        </section>
        @if (errors()?.top) {
          <p
            data-testid="error-top"
            class="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700"
          >
            {{ errors()?.top }}
          </p>
        }
        <details class="rounded border border-slate-200 p-2 text-sm">
          <summary class="cursor-pointer select-none text-slate-700">
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
                class="w-20 rounded border border-slate-300 px-1 py-0.5"
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
            class="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
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
