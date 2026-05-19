import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import type { SavedQuerySummary } from '@app/core';
import { ButtonComponent } from '@app/modules/button';
import { InputComponent } from '@app/modules/input';

@Component({
  selector: 'app-queries-rail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, InputComponent],
  template: `
    <aside
      class="flex w-64 shrink-0 flex-col gap-2 border-r border-border-muted pr-4"
      data-testid="queries-rail"
    >
      <input
        app-input
        type="text"
        data-testid="queries-filter"
        placeholder="filter by slug…"
        [value]="filter()"
        (input)="onFilter($event)"
      />
      @if (writable()) {
        <button
          app-btn
          type="button"
          variant="secondary"
          size="sm"
          data-testid="queries-new"
          (click)="newQuery.emit()"
        >
          + New
        </button>
      }
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
              (click)="selectEntry.emit(entry.slug)"
              class="w-full justify-start truncate text-foreground-muted hover:text-foreground aria-[current=true]:text-foreground"
            >
              {{ entry.slug }}
            </button>
          </li>
        }
      </ul>
    </aside>
  `,
})
export class QueriesRailComponent {
  readonly entries = input<readonly SavedQuerySummary[]>([]);
  readonly selectedSlug = input<string | null>(null);
  readonly writable = input<boolean>(true);
  readonly selectEntry = output<string>();
  readonly newQuery = output<void>();

  readonly filter = signal<string>('');

  readonly visibleEntries = computed(() => {
    const needle = this.filter().trim().toLowerCase();
    const sorted = [...this.entries()].sort((a, b) =>
      a.slug.localeCompare(b.slug),
    );
    if (needle === '') return sorted;
    return sorted.filter((e) => e.slug.toLowerCase().includes(needle));
  });

  onFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }
}
