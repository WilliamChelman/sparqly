import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  SavedQueriesService,
  type LoadedSavedQuery,
  type SavedQuerySummary,
} from '@app/core';
import { ButtonComponent } from '@app/modules/button';

type DetailState =
  | { kind: 'empty' }
  | { kind: 'loading'; slug: string }
  | { kind: 'loaded'; entry: LoadedSavedQuery['entry'] }
  | { kind: 'not-found'; slug: string };

@Component({
  selector: 'app-queries-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent],
  template: `
    <header class="border-b border-border-muted bg-surface px-4 py-3">
      <h1 class="font-serif text-2xl italic text-foreground">saved queries</h1>
      <p class="text-sm text-foreground-muted">
        Browse the saved-query library. Select an entry to view its body.
      </p>
    </header>
    <main class="flex gap-4 p-4">
      <aside
        class="flex w-64 shrink-0 flex-col gap-2 border-r border-border-muted pr-4"
        data-testid="queries-rail"
      >
        <input
          type="text"
          data-testid="queries-filter"
          placeholder="filter by slug…"
          [value]="filter()"
          (input)="onFilter($event)"
          class="rounded border border-border bg-surface px-2 py-1 text-sm text-foreground"
        />
        <ul class="flex flex-col gap-1">
          @for (entry of visibleEntries(); track entry.slug) {
            <li>
              <button
                app-btn
                variant="ghost"
                size="sm"
                type="button"
                data-testid="queries-entry"
                [attr.data-slug]="entry.slug"
                [attr.aria-current]="
                  entry.slug === selectedSlug() ? 'true' : null
                "
                (click)="onSelect(entry.slug)"
                class="w-full justify-start truncate text-foreground-muted hover:text-foreground aria-[current=true]:text-foreground"
              >
                {{ entry.slug }}
              </button>
            </li>
          }
        </ul>
      </aside>
      <section class="flex-1" data-testid="queries-detail">
        @switch (detail().kind) {
          @case ('empty') {
            <p
              class="text-sm text-foreground-faint"
              data-testid="queries-detail-empty"
            >
              Select an entry to view its body.
            </p>
          }
          @case ('loading') {
            <p
              class="text-sm text-foreground-faint"
              data-testid="queries-detail-loading"
            >
              loading…
            </p>
          }
          @case ('not-found') {
            <p
              class="text-sm text-foreground-faint"
              data-testid="queries-detail-not-found"
            >
              No saved query with slug "{{ notFoundSlug() }}".
            </p>
          }
          @case ('loaded') {
            <pre
              data-testid="queries-detail-body"
              class="overflow-auto rounded border border-border-muted bg-surface p-3 font-mono text-sm text-foreground"
            >{{ loadedBody() }}</pre>
          }
        }
      </section>
    </main>
  `,
})
export class QueriesPage implements OnInit {
  private readonly service = inject(SavedQueriesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly entries = signal<readonly SavedQuerySummary[]>([]);
  readonly filter = signal<string>('');
  readonly selectedSlug = signal<string | null>(null);
  readonly detail = signal<DetailState>({ kind: 'empty' });

  readonly visibleEntries = computed(() => {
    const needle = this.filter().trim().toLowerCase();
    const sorted = [...this.entries()].sort((a, b) =>
      a.slug.localeCompare(b.slug),
    );
    if (needle === '') return sorted;
    return sorted.filter((e) => e.slug.toLowerCase().includes(needle));
  });

  readonly loadedBody = computed(() => {
    const d = this.detail();
    return d.kind === 'loaded' ? d.entry.body : '';
  });

  readonly notFoundSlug = computed(() => {
    const d = this.detail();
    return d.kind === 'not-found' ? d.slug : '';
  });

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    this.service.list().subscribe((entries) => {
      this.entries.set(entries);
      if (slug !== null) this.loadSlug(slug);
    });
  }

  onFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  onSelect(slug: string): void {
    // Navigation re-mounts the component for the new param; the fresh
    // instance's ngOnInit reads the slug and loads the entry.
    void this.router.navigate(['/queries', slug], { replaceUrl: true });
  }

  private loadSlug(slug: string): void {
    this.selectedSlug.set(slug);
    const known = this.entries().some((e) => e.slug === slug);
    if (!known) {
      this.detail.set({ kind: 'not-found', slug });
      return;
    }
    this.detail.set({ kind: 'loading', slug });
    this.service.get(slug).subscribe({
      next: (loaded) => {
        if (this.selectedSlug() !== slug) return;
        this.detail.set({ kind: 'loaded', entry: loaded.entry });
      },
      error: () => {
        if (this.selectedSlug() !== slug) return;
        this.detail.set({ kind: 'not-found', slug });
      },
    });
  }
}
