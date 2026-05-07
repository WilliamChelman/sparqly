import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import {
  SourcesPicker,
} from './sources-picker';
import { SourcesService, type SourceListingEntry } from './sources.service';
import {
  DiffService,
  type DiffErrorResponse,
  type DiffRequest,
  type DiffResponse,
} from './diff.service';
import { DiffResultRenderer } from './diff-result-renderer';

@Component({
  selector: 'app-diff-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SourcesPicker, DiffResultRenderer],
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
            <textarea
              class="min-h-32 rounded border border-slate-300 p-2 font-mono text-sm"
              placeholder="optional SPARQL scoping query (left)"
              [value]="leftQuery()"
              (input)="leftQuery.set($any($event.target).value)"
            ></textarea>
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
            <textarea
              class="min-h-32 rounded border border-slate-300 p-2 font-mono text-sm"
              placeholder="optional SPARQL scoping query (right)"
              [value]="rightQuery()"
              (input)="rightQuery.set($any($event.target).value)"
            ></textarea>
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
          <app-diff-result-renderer [result]="r" [context]="context()" />
        }
      </main>
    }
  `,
})
export class DiffPage implements OnInit {
  private readonly sourcesService = inject(SourcesService);
  private readonly diffService = inject(DiffService);

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

  setContext(raw: string): void {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) this.context.set(n);
  }

  ngOnInit(): void {
    this.sourcesService.list().subscribe((listing) => {
      this.sources.set(listing.sources);
      const def = listing.sources.find((s) => s.default === true);
      const initial = def?.id ?? listing.sources[0]?.id ?? '';
      if (initial !== '') {
        this.leftId.set(initial);
        this.rightId.set(initial);
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
