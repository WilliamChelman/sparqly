import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  SOURCE_STATE_STREAM_FACTORY,
  type SourceStateStream,
} from './source-state-stream';

/**
 * Layer 1 of the Sources page row shape (#353, parent #352). The server-side
 * projector in `libs/server/src/lib/sources/source-row-projector.ts` is the
 * source of truth — this declaration is the structural mirror the webapp
 * binds to. Deeper layers (quad counts, build timing, endpoint URL, inline
 * errors) extend the union additively in later slices of #352.
 */
export type SourceRow =
  | {
      mode: 'in-memory';
      id: string;
      kind: 'glob' | 'file' | 'view' | 'empty';
      state: InMemoryState;
      default?: true;
      parentId?: string;
    }
  | {
      mode: 'disk-backed';
      id: string;
      kind: 'glob' | 'file';
      state: DiskBackedState;
      default?: true;
      parentId?: string;
    }
  | {
      mode: 'endpoint';
      id: string;
      kind: 'endpoint';
      default?: true;
    };

export type InMemoryState = 'not-loaded' | 'loading' | 'loaded' | 'failed';
export type DiskBackedState =
  | 'not-built'
  | 'indexing'
  | 'ready'
  | 'stale'
  | 'failed';

/**
 * Foundational tracer for the **Sources page** (#353). Layer 1 only — fetches
 * `GET /api/sources` on init and renders one row per served registry entry
 * with id, kind, and current state. Opening the page must **not** issue any
 * load/build trigger — that's the test invariant that locks ADR-0031's lazy-
 * materialization contract from the page side too. Live updates, action
 * affordances, and deeper layers arrive in later slices of parent #352.
 */
@Component({
  selector: 'app-sources-page',
  standalone: true,
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
        <p class="text-sm text-foreground-muted" data-testid="sources-loading">
          loading…
        </p>
      } @else if (rows()!.length === 0) {
        <p class="text-sm text-foreground-muted" data-testid="sources-empty">
          The served registry is empty.
        </p>
      } @else {
        <ul class="flex flex-col gap-2" data-testid="sources-list">
          @for (row of rows(); track row.id) {
            <li
              class="flex items-center gap-3 rounded border border-border-muted bg-surface px-3 py-2"
              [attr.data-testid]="'source-row-' + row.id"
              [attr.data-source-id]="row.id"
              [attr.data-mode]="row.mode"
              [attr.data-default]="row.default === true ? 'true' : null"
            >
              <span
                class="font-mono text-sm text-foreground"
                data-testid="row-id"
                >{{ row.id }}</span
              >
              <span
                class="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-foreground-muted"
                data-testid="row-kind"
                >{{ row.kind }}</span
              >
              @if (row.mode !== 'endpoint') {
                <span
                  class="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-foreground"
                  data-testid="row-state"
                  >{{ row.state }}</span
                >
              }
              @if (row.default === true) {
                <span
                  class="rounded bg-accent-muted px-1.5 py-0.5 text-xs text-accent"
                  data-testid="row-default"
                  >default</span
                >
              }
            </li>
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

  /** `null` while the initial snapshot is in flight; never repopulated to `null`. */
  readonly rows = signal<SourceRow[] | null>(null);
  /**
   * The live SSE subscription opened after the initial snapshot lands
   * (ADR-0044, #354). Replaced on `refetch-snapshot`; closed on destroy.
   */
  private stream: SourceStateStream | undefined;

  ngOnInit(): void {
    this.fetchSnapshot(/* subscribeAfter */ true);
  }

  ngOnDestroy(): void {
    this.stream?.close();
    this.stream = undefined;
  }

  /**
   * Fetches the canonical snapshot and, on success, opens a fresh live
   * subscription. Used both for first load and for the unbridgeable-
   * reconnect recovery path (ADR-0044's `refetch-snapshot` sentinel).
   */
  private fetchSnapshot(subscribeAfter: boolean): void {
    this.http
      .get<SourceRow[]>('/api/sources')
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (snapshot) => {
          this.rows.set(snapshot);
          if (subscribeAfter) this.subscribe();
        },
        // Layer 1 ignores snapshot failure for now — later slices wire an
        // error banner. Leaving `rows` at `null` keeps the page in its
        // "loading…" state, which is a visible signal something is wrong.
        error: () => {
          /* intentionally empty — see comment above */
        },
      });
  }

  /**
   * Opens a fresh stream and binds the row/sentinel handlers. The existing
   * stream (if any) is closed first — the page never has two live streams
   * at once.
   */
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
      let replaced = false;
      const next = prev.map((r) => {
        if (r.id !== row.id) return r;
        replaced = true;
        return row;
      });
      // Unknown id (e.g. a new source added by config reload) — append it
      // so the page doesn't silently drop the event.
      return replaced ? next : [...next, row];
    });
  }
}
