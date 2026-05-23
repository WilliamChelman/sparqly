import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConfigService } from '../../core/services/config.service';
import {
  errorMessageFirstLine,
  formatBytes,
  hasLoadedChild,
  loadedChildIds,
  reaggregateMeta,
} from './source-row-aggregate';
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
import type {
  DiskBackedState,
  EndpointProbeChip,
  SourceRow,
} from './source-row';

/** Opening the page must not trigger any load/build (lazy-materialization contract). */
@Component({
  selector: 'app-sources-page',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sources.page.html',
})
export class SourcesPage implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly destroy = inject(DestroyRef);
  private readonly streamFactory = inject(SOURCE_STATE_STREAM_FACTORY);
  private readonly configService = inject(ConfigService);

  /** `null` while the initial snapshot is in flight; never repopulated to `null`. */
  readonly rows = signal<SourceRow[] | null>(null);
  private readonly detailsExpanded = signal<Record<string, boolean>>({});
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

  rebuildIndex(id: string, state: DiskBackedState | 'mixed'): void {
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

  isMetaExpanded(id: string): boolean {
    return this.metaExpanded()[id] === true;
  }

  /** Narrows the discriminated union — only in-memory / disk-backed carry `parentId`. */
  parentIdOf(row: SourceRow): string | undefined {
    return row.mode === 'endpoint' ? undefined : row.parentId;
  }

  hasLoadedChild = hasLoadedChild;

  // One POST per child so a failure doesn't stop siblings from being reloaded.
  reloadLoadedChildren(row: SourceRow): void {
    for (const id of loadedChildIds(row)) this.postAction(id, 'reload');
  }

  toggleMeta(id: string): void {
    this.metaExpanded.update((prev) => ({ ...prev, [id]: prev[id] !== true }));
  }

  toggleErrorDetails(id: string): void {
    this.detailsExpanded.update((prev) => ({
      ...prev,
      [id]: prev[id] !== true,
    }));
  }

  errorMessageFirstLine = errorMessageFirstLine;
  formatBytes = formatBytes;

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

  private applyRow(row: SourceRow): void {
    this.rows.update((prev) => {
      if (prev === null) return prev;
      const incomingParentId = this.parentIdOf(row);
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
