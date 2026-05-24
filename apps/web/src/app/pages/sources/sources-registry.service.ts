import { HttpClient } from '@angular/common/http';
import {
  DestroyRef,
  Injectable,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConfigService } from '../../core/services/config.service';
import type { SourceRow } from './source-row';
import {
  SOURCE_STATE_STREAM_FACTORY,
  type SourceStateStream,
} from './source-state-stream';

@Injectable()
export class SourcesRegistryService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly destroy = inject(DestroyRef);
  private readonly streamFactory = inject(SOURCE_STATE_STREAM_FACTORY);
  private readonly configService = inject(ConfigService);

  /** `null` while the initial snapshot is in flight; never repopulated to `null`. */
  readonly rows = signal<SourceRow[] | null>(null);

  /** Permissive default: an older `serve` without the flag keeps the menu reachable. */
  readonly allowAdminActions = signal<boolean>(true);

  private stream: SourceStateStream | undefined;

  constructor() {
    this.fetchSnapshot(/* subscribeAfter */ true);
    this.configService
      .sourcesAdmin()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((c) => this.allowAdminActions.set(c.allowAdminActions));
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
      const incomingParentId =
        row.mode === 'endpoint' ? undefined : row.parentId;
      if (incomingParentId !== undefined) {
        return prev.map((r) =>
          r.id === incomingParentId ? this.reaggregateMeta(r, row) : r,
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

  private reaggregateMeta(meta: SourceRow, child: SourceRow): SourceRow {
    if (meta.mode === 'endpoint') return meta;
    if (meta.children === undefined) return meta;
    let replaced = false;
    const nextChildren = meta.children.map((c) => {
      if (c.id !== child.id) return c;
      replaced = true;
      return child;
    });
    if (!replaced) nextChildren.push(child);
    return {
      ...meta,
      children: nextChildren,
      ...this.summarizeMeta(nextChildren, meta),
    } as SourceRow;
  }

  private summarizeMeta(
    children: SourceRow[],
    meta: SourceRow,
  ): {
    state: string;
    quads?: number;
    files?: number;
    loadedAt?: number;
    loadMs?: undefined;
  } {
    const stateOf = (r: SourceRow): string =>
      r.mode === 'endpoint' ? 'endpoint' : r.state;
    let state: string;
    if (children.length === 0) {
      state = stateOf(meta);
    } else {
      state = stateOf(children[0]);
      for (let i = 1; i < children.length; i++) {
        if (stateOf(children[i]) !== state) {
          state = 'mixed';
          break;
        }
      }
    }
    let quads: number | undefined;
    let files = 0;
    let loadedAt: number | undefined;
    for (const c of children) {
      if (c.mode === 'endpoint') continue;
      if (c.state !== 'loaded' && c.state !== 'ready') continue;
      if (typeof c.files === 'number') files += c.files;
      if (typeof c.quads === 'number') quads = (quads ?? 0) + c.quads;
      if (typeof c.loadedAt === 'number') {
        loadedAt =
          loadedAt === undefined ? c.loadedAt : Math.max(loadedAt, c.loadedAt);
      }
    }
    const out: {
      state: string;
      quads?: number;
      files?: number;
      loadedAt?: number;
      loadMs?: undefined;
    } = {
      state,
      loadMs: undefined,
    };
    if (quads !== undefined) out.quads = quads;
    if (files > 0 || loadedAt !== undefined) out.files = files;
    if (loadedAt !== undefined) out.loadedAt = loadedAt;
    return out;
  }
}
