import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  input,
  Output,
  signal,
} from '@angular/core';
import type { SavedQuerySummary } from '@app/core';

@Component({
  selector: 'app-library-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-2">
      <input
        type="text"
        data-testid="library-filter"
        placeholder="filter by name…"
        [value]="filter()"
        (input)="onFilter($event)"
      />
      <ul>
        @for (entry of visibleEntries(); track entry.slug) {
          <li class="flex items-center gap-2">
            <span data-testid="library-entry-slug">{{ entry.slug }}</span>
            <button
              type="button"
              data-testid="library-entry-load"
              (click)="load.emit(entry.slug)"
            >
              load
            </button>
            <button
              type="button"
              data-testid="library-entry-delete"
              (click)="delete.emit(entry.slug)"
            >
              delete
            </button>
          </li>
        }
      </ul>
    </div>
  `,
})
export class LibraryPickerComponent {
  readonly entries = input.required<readonly SavedQuerySummary[]>();
  @Output() readonly load = new EventEmitter<string>();
  @Output() readonly delete = new EventEmitter<string>();

  readonly filter = signal('');

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
