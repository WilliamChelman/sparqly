import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { pageTitle } from '@app/core';
import { SourceCardComponent } from './components/source-card.component';
import {
  SourceFilterBarComponent,
  type SourceFilterCounts,
  type SourceStateFilter,
} from './components/source-filter-bar.component';
import type { SourceRow } from './models/source-row';
export type {
  DiskBackedState,
  EndpointProbeChip,
  InMemoryState,
  SourceRow,
  SourceRowError,
} from './models/source-row';
import { SourcesRegistryService } from './services/sources-registry.service';

/** Opening the page must not trigger any load/build (lazy-materialization contract). */
@Component({
  selector: 'app-sources-page',
  standalone: true,
  imports: [SourceCardComponent, SourceFilterBarComponent],
  providers: [SourcesRegistryService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="border-b border-border-muted bg-surface px-4 py-3">
      <h1 class="font-serif text-2xl italic text-foreground">sources</h1>
      <p class="text-sm text-foreground-muted">
        Served registry snapshot — identity and current load state per entry.
      </p>
    </header>
    <main class="flex flex-col gap-4 p-4">
      @if (rows() === null) {
        <p class="text-sm text-foreground-muted">loading…</p>
      } @else if (rows()!.length === 0) {
        <p class="text-sm text-foreground-muted">
          The served registry is empty.
        </p>
      } @else {
        <app-source-filter-bar
          [(query)]="query"
          [(state)]="state"
          [counts]="counts()"
          [visibleCount]="visibleRows().length"
        ></app-source-filter-bar>

        @if (visibleRows().length === 0) {
          <p
            class="rounded-md border border-dashed border-border-muted p-6 text-center text-sm text-foreground-faint"
          >
            Nothing matches this filter.
          </p>
        } @else {
          <ul class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            @for (row of visibleRows(); track row.id) {
              <li
                app-source-card
                [row]="row"
                [allowAdminActions]="allowAdminActions()"
                [expanded]="isMetaExpanded(row.id)"
                [class.md:col-span-2]="isInExpandedGroup(row)"
                [class.xl:col-span-3]="isInExpandedGroup(row)"
                (toggleMeta)="toggleMeta($event)"
              ></li>
            }
          </ul>
        }
      }
    </main>
  `,
})
export class SourcesPage {
  private readonly registry = inject(SourcesRegistryService);
  private readonly title = inject(Title);

  constructor() {
    this.title.setTitle(pageTitle('', 'Sources'));
  }

  readonly rows = this.registry.rows;
  readonly allowAdminActions = this.registry.allowAdminActions;

  private readonly metaExpanded = signal<Record<string, boolean>>({});

  readonly query = signal<string>('');
  readonly state = signal<SourceStateFilter>('all');

  readonly displayRows = computed<SourceRow[] | null>(() => {
    const list = this.rows();
    if (list === null) return null;
    const expanded = this.metaExpanded();
    const out: SourceRow[] = [];
    for (const row of list) {
      out.push(row);
      if (row.mode === 'endpoint') continue;
      if (row.children === undefined) continue;
      if (expanded[row.id] !== true) continue;
      for (const child of row.children) out.push(child);
    }
    return out;
  });

  /**
   * Counts cover every row + every child regardless of expansion — the chip
   * count is a "what's in the registry" signal, not a "what's in the DOM" one.
   */
  readonly counts = computed<SourceFilterCounts>(() => {
    const c: SourceFilterCounts = {
      all: 0,
      loaded: 0,
      ready: 0,
      'not-loaded': 0,
      'not-built': 0,
      failed: 0,
      stale: 0,
      loading: 0,
      indexing: 0,
      endpoint: 0,
    };
    const visit = (r: SourceRow): void => {
      c.all++;
      if (r.mode === 'endpoint') c.endpoint++;
      else if (r.state in c) (c as Record<string, number>)[r.state]++;
    };
    const list = this.rows();
    if (list === null) return c;
    for (const r of list) {
      visit(r);
      if (r.mode !== 'endpoint' && r.children) {
        for (const ch of r.children) visit(ch);
      }
    }
    return c;
  });

  readonly visibleRows = computed<SourceRow[]>(() => {
    const list = this.displayRows();
    if (list === null) return [];
    const q = this.query().trim().toLowerCase();
    const st = this.state();
    return list.filter((r) => {
      if (q !== '' && !r.id.toLowerCase().includes(q)) return false;
      if (st === 'all') return true;
      if (st === 'endpoint') return r.mode === 'endpoint';
      if (r.mode === 'endpoint') return false;
      return r.state === st;
    });
  });

  isMetaExpanded(id: string): boolean {
    return this.metaExpanded()[id] === true;
  }

  // Parent (expanded with children) OR child of an expanded parent — both get
  // the full-width treatment so the group reads as one contiguous block.
  isInExpandedGroup(row: SourceRow): boolean {
    if (row.mode !== 'endpoint' && row.parentId !== undefined) {
      return this.isMetaExpanded(row.parentId);
    }
    if (row.mode === 'endpoint') return false;
    return row.children !== undefined && this.isMetaExpanded(row.id);
  }

  toggleMeta(id: string): void {
    this.metaExpanded.update((prev) => ({ ...prev, [id]: prev[id] !== true }));
  }
}
