import { DatePipe } from '@angular/common';
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
import { ConfigService } from '../../core/services/config.service';
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
  | ({
      mode: 'in-memory';
      id: string;
      kind: 'glob' | 'file' | 'view' | 'empty';
      state: InMemoryState;
      default?: true;
      parentId?: string;
    } & Layer2Fields)
  | ({
      mode: 'disk-backed';
      id: string;
      kind: 'glob' | 'file';
      state: DiskBackedState;
      default?: true;
      parentId?: string;
    } & Layer2Fields)
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
 * Layer 2 of the Sources page row shape (#355). The server-side projector
 * fills these fields only when state is `loaded` (in-memory) or `ready`
 * (disk-backed). Every field is optional: the page renders an empty cell
 * for any missing value rather than substituting `0`, because "unknown"
 * (e.g. a disk-backed `ready` pre-`quadCount`-manifest) is a meaningfully
 * different signal from "really zero" on this dashboard.
 */
interface Layer2Fields {
  quads?: number;
  files?: number;
  loadedAt?: number;
  loadMs?: number;
}

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
  imports: [DatePipe],
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
              <!--
                Layer 2 metric cells (#355). Rendered for every non-endpoint
                row so the test can find them by selector; populated only
                when the projector has emitted the corresponding field. A
                blank cell means "unknown" — explicitly distinct from a
                literal zero. Pass-through endpoints have no metrics at all
                (no state machine, no materialization), so we skip the cells
                entirely there.
              -->
              @if (row.mode !== 'endpoint') {
                <span
                  class="ml-auto font-mono text-xs text-foreground-muted"
                  data-testid="row-quads"
                  >{{ row.quads ?? '' }}</span
                >
                <span
                  class="font-mono text-xs text-foreground-muted"
                  data-testid="row-files"
                  >{{ row.files ?? '' }}</span
                >
                <span
                  class="font-mono text-xs text-foreground-muted"
                  data-testid="row-loaded-at"
                  >{{ row.loadedAt ? (row.loadedAt | date: 'short') : '' }}</span
                >
                <span
                  class="font-mono text-xs text-foreground-muted"
                  data-testid="row-load-ms"
                  >{{ row.loadMs !== undefined ? row.loadMs + ' ms' : '' }}</span
                >
              }
              <!--
                Per-row admin action menu (#356, ADR-0045). In-memory only;
                disk-backed verbs (Build / Rebuild / Discard) land in a later
                slice of #352. Hidden entirely when the deployment's Source
                admin actions capability is off — a read-only serve should
                not advertise affordances it will then 403 on.
              -->
              @if (allowAdminActions() && row.mode === 'in-memory') {
                @if (row.state === 'not-loaded' || row.state === 'failed') {
                  <button
                    type="button"
                    class="rounded border border-border-muted bg-surface-muted px-2 py-0.5 text-xs text-foreground hover:bg-surface"
                    data-testid="row-action-load"
                    (click)="load(row.id)"
                  >
                    Load
                  </button>
                }
                @if (row.state === 'loaded') {
                  <button
                    type="button"
                    class="rounded border border-border-muted bg-surface-muted px-2 py-0.5 text-xs text-foreground hover:bg-surface"
                    data-testid="row-action-reload"
                    (click)="reload(row.id)"
                  >
                    Reload
                  </button>
                  <button
                    type="button"
                    class="rounded border border-border-muted bg-surface-muted px-2 py-0.5 text-xs text-foreground hover:bg-surface"
                    data-testid="row-action-unload"
                    (click)="unload(row.id)"
                  >
                    Unload
                  </button>
                }
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
  private readonly configService = inject(ConfigService);

  /** `null` while the initial snapshot is in flight; never repopulated to `null`. */
  readonly rows = signal<SourceRow[] | null>(null);
  /**
   * **Source admin actions capability** (ADR-0045, #356), read from
   * `GET /api/config` at boot. `true` is the permissive default — an older
   * `serve` that doesn't expose the flag keeps the action menu reachable.
   * Flips to `false` when the deployment runs `--read-only`, hiding every
   * Load / Reload / Unload affordance the template would otherwise render.
   */
  readonly allowAdminActions = signal<boolean>(true);
  /**
   * The live SSE subscription opened after the initial snapshot lands
   * (ADR-0044, #354). Replaced on `refetch-snapshot`; closed on destroy.
   */
  private stream: SourceStateStream | undefined;

  ngOnInit(): void {
    this.fetchSnapshot(/* subscribeAfter */ true);
    this.configService
      .sourcesAdmin()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((c) => this.allowAdminActions.set(c.allowAdminActions));
  }

  /**
   * Fires `POST /api/sources/:id/load`. The HTTP turn returns `202 Accepted`
   * with the post-action state; we drop the response because the SSE stream
   * is the canonical channel for state transitions — the matching `loading`
   * → `loaded`/`failed` row events flow through `applyRow()` and refresh the
   * cell without a parallel update path.
   */
  load(id: string): void {
    this.postAction(id, 'load');
  }

  /**
   * Fires `POST /api/sources/:id/reload`. Same swallow-and-let-SSE-drive
   * pattern as {@link load}: the response body is the post-action state,
   * but the canonical row update arrives over the live stream regardless.
   */
  reload(id: string): void {
    this.postAction(id, 'reload');
  }

  /**
   * Fires `POST /api/sources/:id/unload`. Idempotent on the server side —
   * an unload against a `not-loaded` entry is a silent no-op there, so the
   * UI doesn't need to disable the button defensively. The `unload`
   * transition (when one fires) flows through SSE; in-flight queries
   * continue against their captured snapshot.
   */
  unload(id: string): void {
    this.postAction(id, 'unload');
  }

  private postAction(id: string, verb: 'load' | 'reload' | 'unload'): void {
    this.http
      .post(`/api/sources/${encodeURIComponent(id)}/${verb}`, null)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => {
          /* SSE drives the UI update; nothing to do here. */
        },
        error: () => {
          /* Layer 1 swallows; later slices wire an error toast. */
        },
      });
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
