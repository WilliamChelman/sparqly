import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  EventEmitter,
  inject,
  input,
  Output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@app/modules/button';
import type { SourceListingEntry } from '@app/core';
import { RefsApiClient } from './refs-api.client';
import { RefsPanelComponent, type RefsPanelState } from './refs-panel.component';
import {
  buildSourceTree,
  type SourceMatchSpan,
  type SourceRow,
  type SourceTreeResult,
} from './source-search';

@Component({
  selector: 'app-sources-picker-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [RefsApiClient],
  imports: [RefsPanelComponent, ButtonComponent],
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
            <div class="flex flex-col gap-1.5 border-b border-border p-3">
              <input
                data-testid="overlay-search"
                type="text"
                placeholder="Search sources…"
                class="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-foreground-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                [value]="query()"
                (input)="onQueryInput($event)"
              />
              @if (query() !== '' && !tree().empty) {
                <p
                  data-testid="overlay-match-count"
                  class="text-[11px] text-foreground-faint"
                >{{ tree().matchCount }} {{ tree().matchCount === 1 ? 'match' : 'matches' }}</p>
              }
            </div>
            @if (tree().empty) {
              <div
                data-testid="overlay-empty"
                class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[13px] text-foreground-muted"
              >
                <p>No sources match your search.</p>
                <button
                  app-btn
                  variant="secondary"
                  size="sm"
                  type="button"
                  data-testid="overlay-clear-search"
                  (click)="query.set('')"
                >Clear search</button>
              </div>
            } @else {
              <ul class="flex-1 list-none overflow-y-auto p-1.5">
                @for (row of tree().rows; track trackByRow(row)) {
                  <li>
                    @if (row.kind === 'group') {
                      <div
                        [attr.data-source-group]="row.entry.id"
                        class="flex w-full items-center gap-0.5 py-0.5"
                      >
                        <button
                          type="button"
                          data-testid="group-chevron"
                          [attr.aria-expanded]="row.expanded"
                          [attr.aria-label]="(row.expanded ? 'Collapse ' : 'Expand ') + row.entry.label"
                          class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                          (click)="toggleGroup(row.entry.id, $event)"
                        >
                          <svg
                            class="h-2.5 w-2.5 transition-transform duration-150"
                            [class.rotate-90]="row.expanded"
                            viewBox="0 0 10 10"
                            aria-hidden="true"
                          >
                            <path d="M3 2 L7 5 L3 8" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                          </svg>
                        </button>
                        @if (row.selectable) {
                          <button
                            type="button"
                            [attr.data-source-id]="row.entry.id"
                            [attr.aria-selected]="stagedId() === row.entry.id ? 'true' : null"
                            [attr.tabindex]="stagedId() === row.entry.id ? 0 : -1"
                            class="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-left font-sans text-[13px] text-foreground-muted hover:bg-surface-sunken hover:text-foreground aria-selected:bg-surface-sunken aria-selected:text-foreground"
                            (click)="focusSource(row.entry.id)"
                          >
                            <span class="min-w-0 truncate">
                              @let segs = labelSegments(row.displayLabel, row.match);
                              <span>{{ segs.before }}</span>
                              @if (segs.match) {
                                <mark
                                  data-testid="match-bold"
                                  class="bg-transparent font-semibold text-foreground"
                                >{{ segs.match }}</mark>
                                <span>{{ segs.after }}</span>
                              }
                            </span>
                            <span
                              data-testid="group-count"
                              class="shrink-0 font-mono text-[11px] text-foreground-faint"
                            >({{ groupCountLabel(row) }})</span>
                          </button>
                        } @else {
                          <div
                            [attr.data-source-breadcrumb]="row.entry.id"
                            class="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1 text-left font-sans text-[13px] text-foreground-faint"
                          >
                            <span class="min-w-0 truncate">{{ row.displayLabel }}</span>
                            <span
                              data-testid="group-count"
                              class="shrink-0 font-mono text-[11px] text-foreground-faint"
                            >({{ groupCountLabel(row) }})</span>
                          </div>
                        }
                      </div>
                    } @else {
                      <button
                        type="button"
                        [attr.data-source-id]="row.entry.id"
                        [attr.data-depth]="row.depth"
                        [attr.aria-selected]="stagedId() === row.entry.id ? 'true' : null"
                        [attr.tabindex]="stagedId() === row.entry.id ? 0 : -1"
                        class="block w-full cursor-pointer rounded-md py-1.5 text-left font-sans text-[13px] text-foreground-muted hover:bg-surface-sunken hover:text-foreground aria-selected:bg-surface-sunken aria-selected:text-foreground"
                        [style.paddingLeft.rem]="row.depth === 1 ? 1.75 : 0.625"
                        [style.paddingRight.rem]="0.625"
                        (click)="focusSource(row.entry.id)"
                      >
                        <span class="min-w-0 truncate">
                          @let segs = labelSegments(row.displayLabel, row.match);
                          <span>{{ segs.before }}</span>
                          @if (segs.match) {
                            <mark
                              data-testid="match-bold"
                              class="bg-transparent font-semibold text-foreground"
                            >{{ segs.match }}</mark>
                            <span>{{ segs.after }}</span>
                          }
                        </span>
                      </button>
                    }
                  </li>
                }
              </ul>
            }
          </div>
          <div class="flex flex-col overflow-hidden">
            <app-refs-panel
              [state]="refsState()"
              [stagedRef]="stagedRef()"
              [refSearch]="refSearch()"
              [refreshError]="refreshError()"
              (stagedRefChange)="stagedRef.set($event)"
              (refSearchChange)="refSearch.set($event)"
              (appliedRef)="onAppliedRef($event)"
              (refresh)="onRefreshRemotes()"
            />
          </div>
        </div>
        <div class="flex items-center justify-end gap-2 border-t border-border bg-surface-sunken px-3 py-2">
          <button
            app-btn
            variant="secondary"
            type="button"
            data-testid="overlay-cancel"
            (click)="onCancel()"
          >Cancel</button>
          <button
            app-btn
            variant="accent"
            type="button"
            data-testid="overlay-apply"
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
  readonly initialRef = input<string>('');
  readonly stagedId = signal<string>('');
  readonly stagedRef = signal<string>('');
  readonly query = signal<string>('');
  readonly refSearch = signal<string>('');
  readonly refsState = signal<RefsPanelState>({ kind: 'idle' });
  readonly refreshError = signal<string | null>(null);
  readonly expandedGroups = signal<ReadonlySet<string>>(new Set());

  readonly tree = computed<SourceTreeResult>(() =>
    buildSourceTree(this.sources(), this.query(), this.expandedGroups()),
  );

  readonly selectableIds = computed<ReadonlyArray<string>>(() =>
    this.tree()
      .rows.filter(
        (r) => r.kind === 'leaf' || (r.kind === 'group' && r.selectable),
      )
      .map((r) => r.entry.id),
  );

  private readonly refsApi = inject(RefsApiClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject(ElementRef<HTMLElement>);
  private lastScrolledSource = '';

  @Output() readonly applied = new EventEmitter<string>();
  @Output() readonly canceled = new EventEmitter<void>();

  constructor() {
    effect(() => {
      this.stagedId.set(this.initialSelectedId());
      this.stagedRef.set(this.initialRef());
    });

    afterNextRender(() => {
      this.ensureStagedExpanded();
      this.scrollStagedSourceIntoView('auto');
    });

    effect(() => {
      const id = this.stagedId();
      if (id === '' || id === this.lastScrolledSource) return;
      this.ensureStagedExpanded();
      queueMicrotask(() => this.scrollStagedSourceIntoView('smooth'));
    });

    effect(() => {
      const id = this.stagedId();
      this.refreshError.set(null);
      if (id === '') {
        this.refsState.set({ kind: 'idle' });
        return;
      }
      this.refsState.set({ kind: 'loading' });
      this.refsApi
        .load(id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((r) => {
          if (this.stagedId() !== id) return;
          if (r.state === 'ok') {
            this.refsState.set({ kind: 'loaded', refs: r.refs });
          } else {
            this.refsState.set({ kind: 'no-git-repo', sourceKind: r.kind });
          }
        });
    });
  }

  private ensureStagedExpanded(): void {
    const id = this.stagedId();
    if (id === '') return;
    const entry = this.sources().find((e) => e.id === id);
    if (entry?.parentId === undefined) return;
    if (this.expandedGroups().has(entry.parentId)) return;
    const next = new Set(this.expandedGroups());
    next.add(entry.parentId);
    this.expandedGroups.set(next);
  }

  private scrollStagedSourceIntoView(behavior: ScrollBehavior): void {
    const id = this.stagedId();
    if (id === '') return;
    const root = this.host.nativeElement as HTMLElement;
    const el = Array.from(
      root.querySelectorAll<HTMLElement>('[data-source-id]'),
    ).find((node) => node.getAttribute('data-source-id') === id);
    if (el === undefined) return;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior });
    }
    this.lastScrolledSource = id;
  }

  onRefreshRemotes(): void {
    const id = this.stagedId();
    if (id === '') return;
    this.refreshError.set(null);
    this.refsApi
      .refresh(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (this.stagedId() !== id) return;
        if (r.state === 'ok') {
          this.refsState.set({ kind: 'loaded', refs: r.refs });
        } else {
          this.refreshError.set(r.kind);
        }
      });
  }

  focusSource(id: string): void {
    if (this.stagedId() !== id) {
      this.stagedRef.set('');
      this.refSearch.set('');
    }
    this.stagedId.set(id);
  }

  toggleGroup(id: string, ev: Event): void {
    ev.stopPropagation();
    const next = new Set(this.expandedGroups());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expandedGroups.set(next);
  }

  onAppliedRef(ref: string): void {
    this.stagedRef.set(ref);
    this.applied.emit(`@${this.stagedId()}:${ref}`);
  }

  onQueryInput(ev: Event): void {
    const target = ev.target as HTMLInputElement;
    this.query.set(target.value);
  }

  trackByRow(row: SourceRow): string {
    return `${row.kind}:${row.entry.id}`;
  }

  groupCountLabel(row: { childCount: number; matchedChildCount: number }): string {
    return this.query() === ''
      ? `${row.childCount}`
      : `${row.matchedChildCount}/${row.childCount}`;
  }

  labelSegments(
    label: string,
    match?: SourceMatchSpan,
  ): { before: string; match: string; after: string } {
    if (match === undefined) return { before: label, match: '', after: '' };
    return {
      before: label.slice(0, match.start),
      match: label.slice(match.start, match.end),
      after: label.slice(match.end),
    };
  }

  onApply(): void {
    const id = this.stagedId();
    const ref = this.stagedRef();
    this.applied.emit(ref === '' ? id : `@${id}:${ref}`);
  }

  moveStaged(delta: number, ev: Event): void {
    ev.preventDefault();
    const ids = this.selectableIds();
    if (ids.length === 0) return;
    const current = ids.indexOf(this.stagedId());
    const nextIdx =
      current === -1
        ? delta > 0
          ? 0
          : ids.length - 1
        : (current + delta + ids.length) % ids.length;
    this.focusSource(ids[nextIdx]);
  }

  onCancel(): void {
    this.canceled.emit();
  }
}
