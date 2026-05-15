import { CdkListboxModule } from '@angular/cdk/listbox';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
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
          @for (s of topLevelIncluded(); track s.id) {
            <li
              [cdkOption]="s.id"
              [attr.data-source-id]="s.id"
              class="flex cursor-pointer items-baseline gap-1 rounded-md px-2.5 py-1.5 font-sans text-[13px] text-foreground-muted hover:bg-surface-sunken hover:text-foreground aria-selected:bg-surface-sunken aria-selected:text-foreground"
            >
              <span>{{ s.label }}</span>
              @if (childrenOfIncluded().get(s.id); as children) {
                <span class="text-foreground-faint">({{ children.length }} files)</span>
                <button
                  type="button"
                  [attr.data-testid]="'group-toggle-' + s.id"
                  class="ml-auto rounded px-1 text-foreground-faint hover:text-foreground"
                  (click)="toggleGroup(s.id, $event)"
                  [attr.aria-expanded]="expandedGroups().has(s.id)"
                >{{ expandedGroups().has(s.id) ? '▾' : '▸' }}</button>
              }
            </li>
            @if (expandedGroups().has(s.id)) {
              @for (c of childrenOfIncluded().get(s.id) ?? []; track c.id) {
                <li
                  [cdkOption]="c.id"
                  [attr.data-source-id]="c.id"
                  class="cursor-pointer rounded-md py-1.5 pl-6 pr-2.5 font-sans text-[13px] text-foreground-muted hover:bg-surface-sunken hover:text-foreground aria-selected:bg-surface-sunken aria-selected:text-foreground"
                >
                  {{ c.label }}
                </li>
              }
            }
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

  readonly topLevelIncluded = computed<SourceListingEntry[]>(() =>
    this.includedSources().filter((s) => !s.parentId),
  );
  readonly childrenOfIncluded = computed<Map<string, SourceListingEntry[]>>(
    () => {
      const m = new Map<string, SourceListingEntry[]>();
      for (const s of this.includedSources()) {
        if (!s.parentId) continue;
        const arr = m.get(s.parentId);
        if (arr) arr.push(s);
        else m.set(s.parentId, [s]);
      }
      return m;
    },
  );
  readonly expandedGroups = signal<ReadonlySet<string>>(new Set());

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

  constructor() {
    effect(() => {
      const ids = this.selectedIds();
      const all = this.sources() ?? [];
      if (all.length === 0 || ids.length === 0) return;
      const parentsToExpand = new Set<string>();
      for (const id of ids) {
        const entry = all.find((s) => s.id === id);
        if (entry?.parentId) parentsToExpand.add(entry.parentId);
      }
      if (parentsToExpand.size === 0) return;
      this.expandedGroups.update((set) => {
        let changed = false;
        const next = new Set(set);
        for (const p of parentsToExpand) {
          if (!next.has(p)) {
            next.add(p);
            changed = true;
          }
        }
        return changed ? next : set;
      });
    });
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  toggleGroup(id: string, ev: Event): void {
    ev.stopPropagation();
    this.expandedGroups.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
