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
  type DiffResponse,
} from './diff.service';

@Component({
  selector: 'app-diff-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SourcesPicker],
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
        @if (result() !== null) {
          <pre
            data-testid="diff-result"
            class="overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-50"
          ><code>{{ resultText() }}</code></pre>
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

  resultText(): string {
    const r = this.result();
    return r === null ? '' : JSON.stringify(r, null, 2);
  }

  run(): void {
    this.running.set(true);
    this.result.set(null);
    this.errors.set(null);
    this.diffService
      .run({
        left: this.leftId(),
        right: this.rightId(),
        leftQuery: this.leftQuery(),
        rightQuery: this.rightQuery(),
      })
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
