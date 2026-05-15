import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  EventEmitter,
  input,
  Output,
  signal,
} from '@angular/core';
import type { SourceListingEntry } from '@app/core';
import { searchSources, type SourceSearchResult } from './source-search';

@Component({
  selector: 'app-sources-picker-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      data-testid="sources-overlay"
      role="dialog"
      aria-modal="true"
      [tabindex]="0"
      class="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 outline-none"
      (keydown.escape)="onCancel()"
      (keydown.arrowdown)="moveStaged(1, $event)"
      (keydown.arrowup)="moveStaged(-1, $event)"
    >
      <div
        class="flex h-[min(640px,80vh)] w-[min(880px,92vw)] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
      >
        <div class="grid flex-1 grid-cols-[1fr_1fr] divide-x divide-border overflow-hidden">
          <div class="flex flex-col overflow-hidden">
            <div class="border-b border-border p-3">
              <input
                data-testid="overlay-search"
                type="text"
                placeholder="Search sources…"
                class="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-foreground-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                [value]="query()"
                (input)="onQueryInput($event)"
              />
            </div>
            @if (result().empty) {
              <div
                data-testid="overlay-empty"
                class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[13px] text-foreground-muted"
              >
                <p>No sources match your search.</p>
                <button
                  type="button"
                  data-testid="overlay-clear-search"
                  class="rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] text-foreground hover:border-foreground-faint"
                  (click)="query.set('')"
                >Clear search</button>
              </div>
            } @else {
              <ul class="flex-1 list-none overflow-y-auto p-1.5">
                @for (hit of result().hits; track hit.entry.id) {
                  <li>
                    <button
                      type="button"
                      [attr.data-source-id]="hit.entry.id"
                      [attr.data-dimmed]="hit.dimmed ? 'true' : null"
                      [attr.aria-selected]="stagedId() === hit.entry.id ? 'true' : null"
                      class="block w-full cursor-pointer rounded-md px-2.5 py-1.5 text-left font-sans text-[13px] text-foreground-muted hover:bg-surface-sunken hover:text-foreground aria-selected:bg-surface-sunken aria-selected:text-foreground data-[dimmed=true]:opacity-50"
                      (click)="stagedId.set(hit.entry.id)"
                    >
                      @let segs = labelSegments(hit.entry.label);
                      <span>{{ segs.before }}</span>
                      @if (segs.match) {
                        <mark
                          data-testid="match-bold"
                          class="bg-transparent font-semibold text-foreground"
                        >{{ segs.match }}</mark>
                        <span>{{ segs.after }}</span>
                      }
                    </button>
                  </li>
                }
              </ul>
            }
          </div>
          <div
            data-testid="refs-panel-stub"
            class="flex flex-col items-center justify-center p-6 text-center text-[13px] text-foreground-faint"
          >
            Refs panel coming soon
          </div>
        </div>
        <div class="flex items-center justify-end gap-2 border-t border-border bg-surface-sunken px-3 py-2">
          <button
            type="button"
            data-testid="overlay-cancel"
            class="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-foreground hover:border-foreground-faint"
            (click)="onCancel()"
          >Cancel</button>
          <button
            type="button"
            data-testid="overlay-apply"
            class="rounded-md border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-surface hover:opacity-90"
            (click)="onApply()"
          >Apply</button>
        </div>
      </div>
    </div>
  `,
})
export class SourcesPickerOverlayComponent {
  readonly sources = input<ReadonlyArray<SourceListingEntry>>([]);
  readonly initialSelectedId = input<string>('');
  readonly stagedId = signal<string>('');
  readonly query = signal<string>('');

  readonly result = computed<SourceSearchResult>(() =>
    searchSources(this.sources(), this.query()),
  );

  @Output() readonly applied = new EventEmitter<string>();
  @Output() readonly canceled = new EventEmitter<void>();

  constructor() {
    effect(() => {
      this.stagedId.set(this.initialSelectedId());
    });
  }

  onQueryInput(ev: Event): void {
    const target = ev.target as HTMLInputElement;
    this.query.set(target.value);
  }

  labelSegments(label: string): { before: string; match: string; after: string } {
    const needle = this.query();
    if (needle === '') return { before: label, match: '', after: '' };
    const idx = label.toLowerCase().indexOf(needle.toLowerCase());
    if (idx === -1) return { before: label, match: '', after: '' };
    return {
      before: label.slice(0, idx),
      match: label.slice(idx, idx + needle.length),
      after: label.slice(idx + needle.length),
    };
  }

  onApply(): void {
    this.applied.emit(this.stagedId());
  }

  moveStaged(delta: number, ev: Event): void {
    ev.preventDefault();
    const visible = this.result().hits.filter((h) => !h.dimmed);
    if (visible.length === 0) return;
    const ids = visible.map((h) => h.entry.id);
    const current = ids.indexOf(this.stagedId());
    const nextIdx =
      current === -1
        ? delta > 0
          ? 0
          : ids.length - 1
        : (current + delta + ids.length) % ids.length;
    this.stagedId.set(ids[nextIdx]);
  }

  onCancel(): void {
    this.canceled.emit();
  }
}
