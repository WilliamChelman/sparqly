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

export type SourceRow =
  | ({
      mode: 'in-memory';
      id: string;
      kind: 'glob' | 'file' | 'view' | 'empty';
      state: InMemoryState;
      default?: true;
      parentId?: string;
    } & Layer2Fields &
      Layer5Fields)
  | ({
      mode: 'disk-backed';
      id: string;
      kind: 'glob' | 'file';
      state: DiskBackedState;
      default?: true;
      parentId?: string;
    } & Layer2Fields &
      Layer3Fields &
      Layer5Fields)
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

interface Layer2Fields {
  quads?: number;
  files?: number;
  loadedAt?: number;
  loadMs?: number;
}

/** `staleReason` is present iff `state === 'stale'`. */
interface Layer3Fields {
  indexDir?: string;
  indexBytes?: number;
  manifestSparqlyVersion?: string;
  staleReason?: string;
}

interface Layer4Fields {
  endpointUrl?: string;
}

/** Present iff state is `failed`; never on endpoint rows. */
interface Layer5Fields {
  error?: SourceRowError;
}

export interface SourceRowError {
  kind: string;
  message: string;
  details?: string;
}

export type EndpointProbeChip =
  | { state: 'pending' }
  | { state: 'ok'; latencyMs: number }
  | { state: 'error'; kind: string; message: string };

/** Opening the page must not trigger any load/build (lazy-materialization contract). */
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
              @if (row.mode !== 'endpoint' && row.state === 'failed' && row.error; as err) {
                <span
                  class="rounded bg-warning-muted px-1.5 py-0.5 text-xs text-warning"
                  data-testid="row-error-chip"
                  [attr.data-kind]="err.kind"
                  >{{ err.kind }} · {{ errorMessageFirstLine(err.message) }}</span
                >
                @if (err.details) {
                  <button
                    type="button"
                    class="rounded border border-border-muted bg-surface-muted px-2 py-0.5 text-xs text-foreground hover:bg-surface"
                    data-testid="row-error-details-toggle"
                    (click)="toggleErrorDetails(row.id)"
                  >
                    {{ isErrorDetailsExpanded(row.id) ? 'Hide details' : 'Show details' }}
                  </button>
                  @if (isErrorDetailsExpanded(row.id)) {
                    <pre
                      class="basis-full whitespace-pre-wrap rounded bg-surface-muted px-2 py-1 font-mono text-xs text-foreground"
                      data-testid="row-error-details"
                      >{{ err.details }}</pre>
                  }
                }
              }
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
                    {{ row.state === 'failed' ? 'Retry' : '(Re)build index' }}
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
                    {{ row.state === 'failed' ? 'Retry' : 'Load' }}
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
  private readonly detailsExpanded = signal<Record<string, boolean>>({});
  private readonly probeChips = signal<Record<string, EndpointProbeChip>>({});
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

  load(id: string): void {
    this.postAction(id, 'load');
  }

  reload(id: string): void {
    this.postAction(id, 'reload');
  }

  unload(id: string): void {
    this.postAction(id, 'unload');
  }

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
          /* state arrives via SSE */
        },
        error: () => {
          /* surfaced on the next snapshot */
        },
      });
  }

  cancelBuild(id: string): void {
    this.http
      .delete(`/api/sources/${encodeURIComponent(id)}/index-build`)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => {
          /* state arrives via SSE */
        },
        error: () => {
          /* surfaced on the next snapshot */
        },
      });
  }

  probeChip(id: string): EndpointProbeChip | undefined {
    return this.probeChips()[id];
  }

  isErrorDetailsExpanded(id: string): boolean {
    return this.detailsExpanded()[id] === true;
  }

  toggleErrorDetails(id: string): void {
    this.detailsExpanded.update((prev) => ({
      ...prev,
      [id]: prev[id] !== true,
    }));
  }

  errorMessageFirstLine(message: string): string {
    const newline = message.indexOf('\n');
    return newline === -1 ? message : message.slice(0, newline);
  }

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
          /* state arrives via SSE */
        },
        error: () => {
          /* surfaced on the next snapshot */
        },
      });
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
      // Unknown id: append (e.g. source added by config reload).
      return replaced ? next : [...next, row];
    });
  }
}
