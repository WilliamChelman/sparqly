import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  EventEmitter,
  input,
  Output,
  signal,
  viewChild,
} from '@angular/core';
import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  type ConnectedPosition,
} from '@angular/cdk/overlay';
import type { SavedQuerySummary } from '@app/core';

@Component({
  selector: 'app-library-combobox',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkOverlayOrigin, CdkConnectedOverlay],
  host: { class: 'relative inline-block' },
  template: `
    <button
      type="button"
      cdkOverlayOrigin
      #trigger="cdkOverlayOrigin"
      data-testid="library-combobox-trigger"
      class="inline-flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface py-2 pl-3 pr-3.5 text-[13px] text-foreground shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:border-foreground-faint active:translate-y-[0.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      [attr.aria-haspopup]="'listbox'"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
    >
      <span
        class="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground-faint"
        >queries</span
      >
      <span class="h-3.5 w-px bg-border" aria-hidden="true"></span>
      <span
        class="font-sans font-medium"
        [class.text-foreground-faint]="!hasSelection()"
        >{{ triggerLabel() }}</span
      >
      <svg
        class="h-2.5 w-2.5 text-foreground-muted transition-transform duration-200"
        [class.rotate-180]="open()"
        viewBox="0 0 10 10"
        aria-hidden="true"
      >
        <path
          d="M2 4 L5 7 L8 4"
          stroke="currentColor"
          stroke-width="1.4"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="trigger"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayHasBackdrop]="true"
      cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
      [cdkConnectedOverlayOffsetY]="6"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayPanelClass]="'library-combobox-overlay'"
      (backdropClick)="close()"
      (detach)="close()"
      (overlayKeydown)="onOverlayKeydown($event)"
    >
      <div
        data-testid="library-combobox-panel"
        role="listbox"
        class="flex max-h-[min(420px,70vh)] w-[min(360px,90vw)] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
      >
        <div class="border-b border-border p-2">
          <input
            #filterInput
            type="text"
            data-testid="library-combobox-filter"
            placeholder="filter by name…"
            class="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-foreground-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            [value]="filter()"
            (input)="onFilter($event)"
          />
        </div>
        @if (visibleEntries().length === 0) {
          <div
            class="flex flex-1 items-center justify-center px-3 py-6 text-center text-[12px] text-foreground-faint"
          >
            @if (entries().length === 0) {
              no saved queries yet
            } @else {
              no matches
            }
          </div>
        } @else {
          <ul class="flex-1 list-none overflow-y-auto p-1">
            @for (entry of visibleEntries(); track entry.slug) {
              <li>
                <button
                  type="button"
                  role="option"
                  data-testid="library-combobox-entry"
                  [attr.aria-selected]="
                    entry.slug === selectedSlug() ? 'true' : null
                  "
                  class="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-sans text-[13px] text-foreground-muted hover:bg-surface-sunken hover:text-foreground aria-selected:bg-surface-sunken aria-selected:font-medium aria-selected:text-foreground"
                  (click)="onPick(entry.slug)"
                >
                  <span class="min-w-0 truncate">{{ entry.slug }}</span>
                  @if (entry.hasParameters) {
                    <span
                      aria-label="has parameters"
                      class="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[10px] text-foreground-faint"
                      >params</span
                    >
                  }
                </button>
              </li>
            }
          </ul>
        }
      </div>
    </ng-template>
  `,
})
export class LibraryComboboxComponent {
  readonly entries = input.required<readonly SavedQuerySummary[]>();
  readonly selectedSlug = input<string | null>(null);
  // eslint-disable-next-line @angular-eslint/no-output-native
  @Output() readonly load = new EventEmitter<string>();

  readonly open = signal<boolean>(false);
  readonly filter = signal<string>('');

  private readonly filterInput =
    viewChild<ElementRef<HTMLInputElement>>('filterInput');

  readonly positions: ConnectedPosition[] = [
    {
      originX: 'start',
      originY: 'bottom',
      overlayX: 'start',
      overlayY: 'top',
    },
    {
      originX: 'start',
      originY: 'top',
      overlayX: 'start',
      overlayY: 'bottom',
    },
  ];

  readonly hasSelection = computed(() => {
    const slug = this.selectedSlug();
    return slug !== null && slug.length > 0;
  });

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

  constructor() {
    effect(() => {
      if (!this.open()) return;
      queueMicrotask(() => this.filterInput()?.nativeElement.focus());
    });
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
    this.filter.set('');
  }

  onFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  onOverlayKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.close();
    }
  }

  onPick(slug: string): void {
    this.open.set(false);
    this.filter.set('');
    this.load.emit(slug);
  }
}
