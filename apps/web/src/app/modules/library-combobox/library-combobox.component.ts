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
  selector: 'app-library-combobox',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative inline-block' },
  template: `
    <button
      type="button"
      data-testid="library-combobox-trigger"
      (click)="toggle()"
    >
      {{ triggerLabel() }}
    </button>
    @if (open()) {
      <div data-testid="library-combobox-panel">
        <input
          type="text"
          data-testid="library-combobox-filter"
          placeholder="filter by name…"
          [value]="filter()"
          (input)="onFilter($event)"
        />
        <ul>
          @for (entry of visibleEntries(); track entry.slug) {
            <li>
              <button
                type="button"
                data-testid="library-combobox-entry"
                (click)="onPick(entry.slug)"
              >
                {{ entry.slug }}
              </button>
            </li>
          }
        </ul>
      </div>
    }
  `,
})
export class LibraryComboboxComponent {
  readonly entries = input.required<readonly SavedQuerySummary[]>();
  readonly selectedSlug = input<string | null>(null);
  // eslint-disable-next-line @angular-eslint/no-output-native
  @Output() readonly load = new EventEmitter<string>();

  readonly open = signal<boolean>(false);
  readonly filter = signal<string>('');

  readonly triggerLabel = computed(() => {
    const slug = this.selectedSlug();
    return slug && slug.length > 0 ? slug : 'load saved query…';
  });

  readonly visibleEntries = computed(() => {
    const needle = this.filter().trim().toLowerCase();
    const sorted = [...this.entries()].sort((a, b) =>
      a.slug.localeCompare(b.slug),
    );
    if (needle === '') return sorted;
    return sorted.filter((e) => e.slug.toLowerCase().includes(needle));
  });

  toggle(): void {
    this.open.update((v) => !v);
  }

  onFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  onPick(slug: string): void {
    this.open.set(false);
    this.filter.set('');
    this.load.emit(slug);
  }
}
