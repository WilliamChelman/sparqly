import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConfigService } from '../../core/services/config.service';
import { reaggregateMeta } from './source-row-aggregate';
import { SourceRowComponent } from './source-row.component';
import {
  SOURCE_STATE_STREAM_FACTORY,
  type SourceStateStream,
} from './source-state-stream';
export type {
  DiskBackedState,
  EndpointProbeChip,
  InMemoryState,
  SourceRow,
  SourceRowError,
} from './source-row';
import type { SourceRow } from './source-row';

/** Opening the page must not trigger any load/build (lazy-materialization contract). */
@Component({
  selector: 'app-sources-page',
  standalone: true,
  imports: [SourceRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="border-b border-border-muted bg-surface px-4 py-3">
      <h1 class="font-serif text-2xl italic text-foreground">sources</h1>
      <p class="text-sm text-foreground-muted">
        Served registry snapshot — identity and current load state per entry.
      </p>
    </header>
    <main class="p-4">
      @if (rows() === null) {
        <p class="text-sm text-foreground-muted" data-testid="sources-loading">loading…</p>
      } @else if (rows()!.length === 0) {
        <p class="text-sm text-foreground-muted" data-testid="sources-empty">
          The served registry is empty.
        </p>
      } @else {
        <ul class="flex flex-col gap-2" data-testid="sources-list">
          @for (row of displayRows(); track row.id) {
            <li
              app-source-row
              [row]="row"
              [allowAdminActions]="allowAdminActions()"
              [expanded]="isMetaExpanded(row.id)"
              (toggleMeta)="toggleMeta($event)"
            ></li>
          }
        </ul>
      }
    </main>
  `,
})
export class SourcesPage implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly destroy = inject(DestroyRef);
  private readonly streamFactory = inject(SOURCE_STATE_STREAM_FACTORY);
  private readonly configService = inject(ConfigService);

  /** `null` while the initial snapshot is in flight; never repopulated to `null`. */
  readonly rows = signal<SourceRow[] | null>(null);
  private readonly metaExpanded = signal<Record<string, boolean>>({});

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

  /** Permissive default: an older `serve` without the flag keeps the menu reachable. */
  readonly allowAdminActions = signal<boolean>(true);
  private stream: SourceStateStream | undefined;

  ngOnInit(): void {
    this.fetchSnapshot(/* subscribeAfter */ true);
    this.configService
      .sourcesAdmin()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((c) => this.allowAdminActions.set(c.allowAdminActions));
  }

  isMetaExpanded(id: string): boolean {
    return this.metaExpanded()[id] === true;
  }

  toggleMeta(id: string): void {
    this.metaExpanded.update((prev) => ({ ...prev, [id]: prev[id] !== true }));
  }

  ngOnDestroy(): void {
    this.stream?.close();
    this.stream = undefined;
  }

  private fetchSnapshot(subscribeAfter: boolean): void {
    this.http
      .get<SourceRow[]>('/api/sources')
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (snapshot) => {
          this.rows.set(snapshot);
          if (subscribeAfter) this.subscribe();
        },
        error: () => {
          /* leaves rows null; the page renders its loading state */
        },
      });
  }

  private subscribe(): void {
    this.stream?.close();
    this.stream = this.streamFactory.open({
      onRow: (row) => this.applyRow(row),
      onRefetchSnapshot: () => {
        this.stream?.close();
        this.stream = undefined;
        this.fetchSnapshot(/* subscribeAfter */ true);
      },
    });
  }

  private applyRow(row: SourceRow): void {
    this.rows.update((prev) => {
      if (prev === null) return prev;
      const incomingParentId = row.mode === 'endpoint' ? undefined : row.parentId;
      if (incomingParentId !== undefined) {
        return prev.map((r) =>
          r.id === incomingParentId ? reaggregateMeta(r, row) : r,
        );
      }
      let replaced = false;
      const next = prev.map((r) => {
        if (r.id !== row.id) return r;
        replaced = true;
        // Meta-row events from the server omit the child array — preserve it.
        if (r.mode !== 'endpoint' && row.mode !== 'endpoint' && r.children) {
          return { ...row, children: r.children } as SourceRow;
        }
        return row;
      });
      return replaced ? next : [...next, row];
    });
  }
}
