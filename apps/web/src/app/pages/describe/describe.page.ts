import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { QuadTableComponent } from './components/quad-table.component';
import {
  DescribeService,
  type DescribeResponse,
} from './services/describe.service';

@Component({
  selector: 'app-describe-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QuadTableComponent],
  template: `
    <header class="border-b border-border-muted bg-surface px-4 py-3">
      <h1 class="font-serif text-2xl italic text-foreground">describe</h1>
      <p class="text-sm text-foreground-muted">
        Resolve every quad about a seed IRI in the registry's first glob source.
      </p>
    </header>
    <main class="flex flex-col gap-3 p-4">
      <div class="flex items-center gap-2">
        <input
          data-testid="seed-input"
          type="text"
          class="flex-1 rounded border border-border bg-surface px-2 py-1 font-mono text-sm text-foreground"
          placeholder="http://example.org/alice"
          [value]="seed()"
          (input)="seed.set($any($event.target).value)"
        />
        <button
          data-testid="run-describe"
          type="button"
          class="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground shadow-sm transition-colors hover:bg-accent-strong disabled:opacity-50"
          [disabled]="running() || seed().length === 0"
          (click)="run()"
        >
          {{ running() ? 'running…' : 'Describe' }}
        </button>
      </div>
      @if (running()) {
        <div data-testid="spinner" class="text-sm text-foreground-faint">
          loading…
        </div>
      }
      @if (response(); as resp) {
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
export class DescribePage {
  private readonly describeService = inject(DescribeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly seed = signal<string>('');
  readonly submittedSeed = signal<string>('');
  readonly running = signal<boolean>(false);
  readonly response = signal<DescribeResponse | null>(null);

  constructor() {
    const iri = this.route.snapshot.queryParamMap.get('iri');
    if (iri !== null) this.seed.set(iri);
  }

  run(): void {
    const iri = this.seed();
    if (iri.length === 0) return;
    this.submittedSeed.set(iri);
    this.running.set(true);
    this.response.set(null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { iri },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.describeService.run({ iri }).subscribe({
      next: (resp) => {
        this.running.set(false);
        this.response.set(resp);
      },
      error: () => {
        this.running.set(false);
      },
    });
  }
}
