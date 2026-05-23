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
    } & Layer2Fields &
      Layer3Fields)
  | ({
      mode: 'endpoint';
      id: string;
      kind: 'endpoint';
      default?: true;
    } & Layer4Fields);

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
 * Layer 3 disk-backed extras (#357). Only disk-backed rows ever carry these:
 * `indexDir` is the absolute path of the on-disk Glob index; `indexBytes` is
 * its LevelDB footprint; `manifestSparqlyVersion` is whichever sparqly built
 * the index. `staleReason` is gated by the server-side projector — it ships
 * exactly when `state === 'stale'`, so a stray reason on a `ready` row is a
 * server bug, not a "harmless extra field" the page should defend against.
 * Every field is optional on the wire so a pre-`ready` row (`not-built`,
 * `indexing`) renders blank cells rather than `undefined`.
 */
interface Layer3Fields {
  indexDir?: string;
  indexBytes?: number;
  manifestSparqlyVersion?: string;
  staleReason?: string;
}

/**
 * Layer 4 endpoint extras (#359). Only endpoint rows carry these. `endpointUrl`
 * is the absolute URL of the remote SPARQL endpoint declared by the source —
 * surfaces alongside the @id on the row so an operator can tell two
 * registries with the same id apart, and so the row chip can identify which
 * remote a `Test connection` probe is about to hit.
 */
interface Layer4Fields {
  endpointUrl?: string;
}

/**
 * Outcome of a click on the **Test connection** button (#359). The wire shape
 * is the controller's `ProbeResult`; the page renders it as a chip on the
 * endpoint row — green tick + latency on ok, red kind chip + first-line
 * message on err. Always paired with a `pending` state in the page cache so
 * the click can render a spinner until the probe settles.
 */
export type EndpointProbeChip =
  | { state: 'pending' }
  | { state: 'ok'; latencyMs: number }
  | { state: 'error'; kind: string; message: string };

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
                Layer 3 disk-backed extras (#357). Rendered only on disk-backed
                rows — in-memory and endpoint sources have no on-disk index to
                describe. Cells render unconditionally (blank when unknown)
                inside the disk-backed branch so test selectors can find them;
                the stale-reason chip is gated on state === stale because it
                only exists for that state (the wire never carries it
                elsewhere — that is the server-projector invariant).
              -->
              @if (row.mode === 'disk-backed') {
                <span
                  class="font-mono text-xs text-foreground-muted"
                  data-testid="row-index-dir"
                  >{{ row.indexDir ?? '' }}</span
                >
                <span
                  class="font-mono text-xs text-foreground-muted"
                  data-testid="row-index-bytes"
                  >{{ formatBytes(row.indexBytes) }}</span
                >
                <span
                  class="font-mono text-xs text-foreground-muted"
                  data-testid="row-manifest-version"
                  >{{ row.manifestSparqlyVersion ?? '' }}</span
                >
                @if (row.state === 'stale' && row.staleReason) {
                  <span
                    class="rounded bg-warning-muted px-1.5 py-0.5 text-xs text-warning"
                    data-testid="row-stale-reason"
                    >{{ row.staleReason }}</span
                  >
                }
              }
              <!--
                Per-row admin action menu (#356, ADR-0045). In-memory only;
                disk-backed verbs (Build / Rebuild / Discard) land in a later
                slice of #352. Hidden entirely when the deployment's Source
                admin actions capability is off — a read-only serve should
                not advertise affordances it will then 403 on.
              -->
              <!--
                Disk-backed admin verbs (#358, ADR-0043). (Re)build appears on
                every disk-backed row except an in-flight indexing one — a
                fresh trigger during an in-flight build would coalesce
                server-side, so the UI hides it to avoid pretending a queued
                second build exists. Cancel is the inverse: visible only
                during indexing so the operator can disown an accidental
                20-minute rebuild with one click. Confirm-on-rebuild gates
                the ready/stale cases where the existing on-disk index is
                the meaningful state to preserve; not-built and failed skip
                confirm — there is no built-up state to lose.
              -->
              @if (allowAdminActions() && row.mode === 'endpoint') {
                <button
                  type="button"
                  class="rounded border border-border-muted bg-surface-muted px-2 py-0.5 text-xs text-foreground hover:bg-surface"
                  data-testid="row-action-test-connection"
                  (click)="testConnection(row.id)"
                >
                  Test connection
                </button>
                @if (probeChip(row.id); as chip) {
                  <span
                    class="rounded px-1.5 py-0.5 text-xs"
                    [class.bg-surface-muted]="chip.state === 'pending'"
                    [class.text-foreground-muted]="chip.state === 'pending'"
                    [class.bg-accent-muted]="chip.state === 'ok'"
                    [class.text-accent]="chip.state === 'ok'"
                    [class.bg-warning-muted]="chip.state === 'error'"
                    [class.text-warning]="chip.state === 'error'"
                    data-testid="row-test-connection-chip"
                    [attr.data-state]="chip.state"
                    [attr.data-kind]="chip.state === 'error' ? chip.kind : null"
                  >
                    @switch (chip.state) {
                      @case ('pending') { probing… }
                      @case ('ok') { ok · {{ chip.latencyMs }} ms }
                      @case ('error') { {{ chip.kind }} · {{ chip.message }} }
                    }
                  </span>
                }
              }
              @if (allowAdminActions() && row.mode === 'disk-backed') {
                @if (row.state !== 'indexing') {
                  <button
                    type="button"
                    class="rounded border border-border-muted bg-surface-muted px-2 py-0.5 text-xs text-foreground hover:bg-surface"
                    data-testid="row-action-rebuild-index"
                    (click)="rebuildIndex(row.id, row.state)"
                  >
                    (Re)build index
                  </button>
                }
                @if (row.state === 'indexing') {
                  <button
                    type="button"
                    class="rounded border border-border-muted bg-surface-muted px-2 py-0.5 text-xs text-foreground hover:bg-surface"
                    data-testid="row-action-cancel-build"
                    (click)="cancelBuild(row.id)"
                  >
                    Cancel
                  </button>
                }
              }
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
   * Per-row **Test connection** chip cache (#359). Keyed by source @id;
   * absent when the user has not clicked the button yet (so no chip
   * renders). A click writes `pending` immediately, then overwrites with
   * the probe verdict when the HTTP turn settles. The verdict is **never
   * memoized server-side** (PRD user story 20), and the page mirrors that
   * by overwriting — not merging — on each click.
   */
  private readonly probeChips = signal<Record<string, EndpointProbeChip>>({});
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

  /**
   * Fires `POST /api/sources/:id/index-build` — user-triggered (Re)build of
   * a disk-backed Glob index (ADR-0043, #358). Prompts the operator before
   * destroying the existing index when there is built-up state to preserve
   * (`ready` or `stale`); skips the confirm on `not-built` / `failed` where
   * rebuild is the only path forward. Same swallow-and-let-SSE-drive
   * pattern as the in-memory verbs — the `build-start`/`build-success`
   * transitions arrive on the live stream.
   */
  rebuildIndex(id: string, state: DiskBackedState): void {
    if (state === 'ready' || state === 'stale') {
      const ok = window.confirm(
        `Rebuild the Glob index for ${id}? The current index will be replaced once the new build completes.`,
      );
      if (!ok) return;
    }
    this.http
      .post(`/api/sources/${encodeURIComponent(id)}/index-build`, null)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => {
          /* SSE drives the UI update. */
        },
        error: () => {
          /* Layer 1 swallows; later slices wire an error toast. */
        },
      });
  }

  /**
   * Fires `DELETE /api/sources/:id/index-build` — operator cancel of an
   * in-flight (Re)build (ADR-0043, #358). No confirm: cancel is the
   * "cheap, always-safe undo" the ADR explicitly designs for; the prior
   * index stays intact at the real path.
   */
  cancelBuild(id: string): void {
    this.http
      .delete(`/api/sources/${encodeURIComponent(id)}/index-build`)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => {
          /* SSE drives the UI update. */
        },
        error: () => {
          /* Layer 1 swallows. */
        },
      });
  }

  /**
   * Reads the current **Test connection** chip for `id` from the per-row
   * cache (#359). Returns `undefined` when the operator has not clicked the
   * button yet — the template uses that to skip rendering the chip element
   * at all, so an unprobed endpoint row stays uncluttered.
   */
  probeChip(id: string): EndpointProbeChip | undefined {
    return this.probeChips()[id];
  }

  /**
   * Fires `POST /api/sources/:id/test-connection` (#359). Writes a `pending`
   * chip immediately so the operator sees feedback within one frame, then
   * overwrites with the probe verdict when the HTTP turn settles. Mirrors the
   * server's "never memoize" contract by overwriting (not merging) on every
   * click — a stale chip from a prior click cannot survive a re-probe.
   * Transport-level failures (network down, 5xx without a `ProbeResult` body)
   * surface as a synthetic `transport` error chip so the operator can tell
   * "endpoint said no" from "couldn't reach the server at all."
   */
  testConnection(id: string): void {
    this.probeChips.update((prev) => ({ ...prev, [id]: { state: 'pending' } }));
    this.http
      .post<
        | { ok: true; latencyMs: number }
        | { ok: false; error: { kind: string; message: string }; latencyMs: number }
      >(`/api/sources/${encodeURIComponent(id)}/test-connection`, null)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (result) => {
          this.probeChips.update((prev) => ({
            ...prev,
            [id]: result.ok
              ? { state: 'ok', latencyMs: result.latencyMs }
              : {
                  state: 'error',
                  kind: result.error.kind,
                  message: result.error.message,
                },
          }));
        },
        error: () => {
          this.probeChips.update((prev) => ({
            ...prev,
            [id]: {
              state: 'error',
              kind: 'transport',
              message: 'probe request failed',
            },
          }));
        },
      });
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

  /**
   * Formats a Layer 3 `indexBytes` count for the row cell (#357). Renders an
   * empty cell for `undefined` so "unknown" stays distinct from "really zero
   * bytes". Picks a binary unit (KiB/MiB/GiB) so a 600 MiB index doesn't
   * print as a nine-digit byte count.
   */
  formatBytes(bytes: number | undefined): string {
    if (bytes === undefined) return '';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = bytes / 1024;
    let unit = units[0];
    for (let i = 1; i < units.length && v >= 1024; i++) {
      v /= 1024;
      unit = units[i];
    }
    return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${unit}`;
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
