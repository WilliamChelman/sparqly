import { CdkListboxModule } from '@angular/cdk/listbox';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  inject,
  Input,
  OnInit,
  Output,
  signal,
} from '@angular/core';
import {
  ConfigService,
  type SourceKind,
  type SourceListingEntry,
} from '@app/core';

@Component({
  selector: 'app-multi-sources-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkListboxModule],
  host: { class: 'relative inline-block' },
  template: `
    @if (sources() === null) {
      <span class="text-sm text-foreground-faint">loading sources…</span>
    } @else if (includedSources().length === 1) {
      <span
        data-testid="multi-sources-locked"
        class="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground"
      >
        <span
          class="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground-faint"
          >{{ label }}</span
        >
        <span class="h-3.5 w-px bg-border" aria-hidden="true"></span>
        <span class="font-sans font-medium">{{ includedSources()[0].label }}</span>
      </span>
    } @else {
      <button
        data-testid="multi-sources-trigger"
        type="button"
        class="inline-flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface py-2 pl-3 pr-3.5 text-[13px] text-foreground shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:border-foreground-faint active:translate-y-[0.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        [attr.aria-haspopup]="'listbox'"
        [attr.aria-expanded]="open()"
        (click)="toggle()"
      >
        <span
          class="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground-faint"
          >{{ label }}</span
        >
        <span class="h-3.5 w-px bg-border" aria-hidden="true"></span>
        <span class="font-sans font-medium">{{ triggerLabel() }}</span>
      </button>
      @if (selectedIds().length === 0) {
        <button
          data-testid="select-all"
          type="button"
          class="ml-2 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground-muted hover:bg-surface-sunken"
          (click)="selectAll()"
        >
          Select all
        </button>
      }
      @if (open()) {
        <ul
          cdkListbox
          [cdkListboxMultiple]="true"
          class="absolute left-0 top-[calc(100%+6px)] z-10 m-0 min-w-full list-none rounded-lg border border-border bg-surface p-1.5 shadow-md"
          [tabindex]="0"
          [cdkListboxValue]="selectedIds()"
          (cdkListboxValueChange)="onPick($event.value)"
          (keydown.escape)="close()"
        >
          @for (s of includedSources(); track s.id) {
            <li
              [cdkOption]="s.id"
              [attr.data-source-id]="s.id"
              class="cursor-pointer rounded-md px-2.5 py-1.5 font-sans text-[13px] text-foreground-muted hover:bg-surface-sunken hover:text-foreground aria-selected:bg-surface-sunken aria-selected:text-foreground"
            >
              {{ s.label }}
            </li>
          }
        </ul>
      }
    }
  `,
})
export class MultiSourcesPickerComponent implements OnInit {
  @Input() label = 'sources';
  @Output() valueChange = new EventEmitter<string[]>();

  private readonly configService = inject(ConfigService);
  readonly sources = signal<SourceListingEntry[] | null>(null);
  readonly excludeKindsSig = signal<ReadonlyArray<SourceKind>>(['empty']);
  readonly selectedIds = signal<string[]>([]);
  readonly open = signal<boolean>(false);
  private explicitValueProvided = false;

  readonly includedSources = computed<SourceListingEntry[]>(() => {
    const all = this.sources();
    if (!all) return [];
    const excluded = new Set(this.excludeKindsSig());
    return all.filter((s) => !excluded.has(s.kind));
  });

  readonly triggerLabel = computed(() => {
    const n = this.selectedIds().length;
    const total = this.includedSources().length;
    if (n === 0) return '0 selected';
    if (n === total) return `all (${n})`;
    return `${n} of ${total}`;
  });

  @Input() set value(v: string[] | null | undefined) {
    if (v === null || v === undefined) return;
    this.explicitValueProvided = true;
    this.selectedIds.set([...v]);
  }

  @Input() set excludeKinds(v: ReadonlyArray<SourceKind> | null | undefined) {
    if (v) this.excludeKindsSig.set([...v]);
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  onPick(value: readonly string[]): void {
    this.commit(orderByListing([...value], this.includedSources()));
  }

  selectAll(): void {
    this.commit(this.includedSources().map((s) => s.id));
  }

  private commit(ids: string[]): void {
    this.selectedIds.set(ids);
    this.valueChange.emit(ids);
  }

  ngOnInit(): void {
    this.configService.list().subscribe((listing) => {
      this.sources.set(listing.sources);
      if (!this.explicitValueProvided) {
        const all = this.includedSources().map((s) => s.id);
        this.selectedIds.set(all);
        this.valueChange.emit(all);
      }
    });
  }
}

function orderByListing(
  ids: ReadonlyArray<string>,
  listing: ReadonlyArray<SourceListingEntry>,
): string[] {
  const want = new Set(ids);
  return listing.filter((s) => want.has(s.id)).map((s) => s.id);
}
