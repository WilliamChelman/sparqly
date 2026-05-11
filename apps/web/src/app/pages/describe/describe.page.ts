import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MultiSourcesPickerComponent } from '@app/modules/multi-sources-picker';
import { ConfigService } from '@app/core';
import { QuadTableComponent } from './components/quad-table.component';
import { SourceErrorsComponent } from './components/source-errors.component';
import { describeIriExpand } from './utils/describe-iri-expand';
import {
  DescribeService,
  type DescribeResponse,
} from './services/describe.service';

@Component({
  selector: 'app-describe-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QuadTableComponent, MultiSourcesPickerComponent, SourceErrorsComponent],
  template: `
    <header class="border-b border-border-muted bg-surface px-4 py-3">
      <h1 class="font-serif text-2xl italic text-foreground">describe</h1>
      <p class="text-sm text-foreground-muted">
        Resolve every quad about a seed IRI across the registry's glob sources.
      </p>
    </header>
    <main class="flex flex-col gap-3 p-4">
      <div class="flex flex-wrap items-center gap-2">
        <input
          data-testid="seed-input"
          type="text"
          class="flex-1 rounded border border-border bg-surface px-2 py-1 font-mono text-sm text-foreground"
          placeholder="http://example.org/alice — or ex:alice"
          [value]="seed()"
          (input)="onSeedInput($any($event.target).value)"
          (keydown.enter)="run()"
        />
        <app-multi-sources-picker
          [value]="initialSources()"
          (valueChange)="onSourcesChange($event)"
        />
        <button
          data-testid="run-describe"
          type="button"
          class="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground shadow-sm transition-colors hover:bg-accent-strong disabled:opacity-50"
          [disabled]="running() || seed().trim().length === 0"
          (click)="run()"
        >
          {{ running() ? 'running…' : 'Describe' }}
        </button>
      </div>
      @if (iriError(); as msg) {
        <p
          data-testid="iri-error"
          class="rounded border border-error-line bg-error-bg p-2 text-sm text-error"
        >
          {{ msg }}
        </p>
      }
      @if (running()) {
        <div data-testid="spinner" class="text-sm text-foreground-faint">
          loading…
        </div>
      }
      @if (response(); as resp) {
        <app-source-errors [perSource]="resp.perSource" />
        <section class="flex flex-col gap-2">
          <p class="text-sm text-foreground-muted">
            <span data-testid="describe-total">{{ resp.total }}</span> quad(s).
          </p>
          <app-quad-table [quadsText]="resp.quads" [seed]="submittedSeed()" />
        </section>
      }
    </main>
  `,
})
export class DescribePage implements OnInit {
  private readonly describeService = inject(DescribeService);
  private readonly configService = inject(ConfigService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly seed = signal<string>('');
  readonly submittedSeed = signal<string>('');
  readonly running = signal<boolean>(false);
  readonly response = signal<DescribeResponse | null>(null);
  readonly iriError = signal<string | null>(null);
  // null means "no override" (server defaults to all sources).
  private selectedSources: string[] | null = null;
  readonly initialSources = signal<string[] | undefined>(undefined);
  private prefixes: Record<string, string> = {};

  constructor() {
    const iri = this.route.snapshot.queryParamMap.get('iri');
    if (iri !== null) this.seed.set(iri);
    const sources = this.route.snapshot.queryParamMap.get('sources');
    if (sources !== null) {
      const ids = sources
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      this.selectedSources = ids;
      this.initialSources.set(ids);
    }
  }

  ngOnInit(): void {
    this.configService.config().subscribe((config) => {
      this.prefixes = config.context.prefixes;
      // A URL carrying ?iri is a bookmark — rehydrate and run immediately.
      if (this.seed().trim().length > 0) this.run();
    });
  }

  onSeedInput(value: string): void {
    this.seed.set(value);
    this.iriError.set(null);
  }

  onSourcesChange(value: string[]): void {
    this.selectedSources = value;
  }

  run(): void {
    const expanded = describeIriExpand(this.seed(), this.prefixes);
    if (!expanded.ok) {
      this.iriError.set(expanded.error);
      return;
    }
    const iri = expanded.iri;
    this.iriError.set(null);
    this.submittedSeed.set(iri);
    this.running.set(true);
    this.response.set(null);
    const queryParams: Record<string, string | null> = { iri };
    if (this.selectedSources !== null) {
      queryParams['sources'] = this.selectedSources.join(',');
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    const req =
      this.selectedSources !== null
        ? { iri, sources: this.selectedSources }
        : { iri };
    this.describeService.run(req).subscribe({
      next: (resp) => {
        this.running.set(false);
        this.response.set(resp);
      },
      error: (err: unknown) => {
        this.running.set(false);
        // `/api/describe` returns 502 with the same response shape (per-source
        // error map, empty quads) when every selected source failed — surface
        // it so the error rows still render.
        const body = (err as { error?: unknown } | null)?.error;
        if (
          body !== null &&
          typeof body === 'object' &&
          'perSource' in (body as Record<string, unknown>)
        ) {
          this.response.set(body as DescribeResponse);
        }
      },
    });
  }
}
