/* eslint-disable @angular-eslint/component-selector */
// ADR-0034 precedent: attribute component on the consumer's existing `<li>`,
// so the row stays a single list item with no extra wrapper that would break
// the flex layout or the test `querySelector` chains.
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Observable } from 'rxjs';
import { ButtonComponent } from '@app/modules/button';
import {
  errorMessageFirstLine,
  formatBytes,
  hasLoadedChild,
  loadedChildIds,
} from './source-row-aggregate';
import type { EndpointProbeChip, SourceRow } from './source-row';
import { SourceActionsService } from './source-actions.service';

@Component({
  selector: 'li[app-source-row]',
  standalone: true,
  imports: [DatePipe, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'flex items-center gap-3 rounded border border-border-muted bg-surface px-3 py-2',
    '[class.pl-8]': 'parentId() !== undefined',
    '[attr.data-testid]': '"source-row-" + row().id',
    '[attr.data-source-id]': 'row().id',
    '[attr.data-mode]': 'row().mode',
    '[attr.data-default]': 'row().default === true ? "true" : null',
    '[attr.data-expanded]': 'expanded() ? "true" : null',
    '[attr.data-parent-id]': 'parentId() ?? null',
  },
  template: `
    @let r = row();
    @if (r.mode !== 'endpoint' && r.children) {
      <button
        app-btn
        variant="secondary"
        size="sm"
        type="button"
        data-testid="row-disclosure-toggle"
        [attr.aria-expanded]="expanded()"
        (click)="onToggleMeta()"
      >
        {{ expanded() ? '▾' : '▸' }}
      </button>
    }
    <span class="font-mono text-sm text-foreground" data-testid="row-id">{{ r.id }}</span>
    <span
      class="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-foreground-muted"
      data-testid="row-kind"
      >{{ r.kind }}</span
    >
    @if (r.mode !== 'endpoint') {
      <span
        class="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-foreground"
        data-testid="row-state"
        >{{ r.state }}</span
      >
    }
    @if (r.default === true) {
      <span
        class="rounded bg-accent-muted px-1.5 py-0.5 text-xs text-accent"
        data-testid="row-default"
        >default</span
      >
    }
    @if (r.mode !== 'endpoint') {
      <span class="ml-auto font-mono text-xs text-foreground-muted" data-testid="row-quads">{{
        r.quads ?? ''
      }}</span>
      <span class="font-mono text-xs text-foreground-muted" data-testid="row-files">{{
        r.files ?? ''
      }}</span>
      <span class="font-mono text-xs text-foreground-muted" data-testid="row-loaded-at">{{
        r.loadedAt ? (r.loadedAt | date: 'short') : ''
      }}</span>
      <span class="font-mono text-xs text-foreground-muted" data-testid="row-load-ms">{{
        r.loadMs !== undefined ? r.loadMs + ' ms' : ''
      }}</span>
    }
    @if (r.mode !== 'endpoint' && r.state === 'failed' && r.error; as err) {
      <span
        class="rounded bg-warning-muted px-1.5 py-0.5 text-xs text-warning"
        data-testid="row-error-chip"
        [attr.data-kind]="err.kind"
        >{{ err.kind }} · {{ errorMessageFirstLine(err.message) }}</span
      >
      @if (err.details) {
        <button
          app-btn
          variant="secondary"
          size="sm"
          type="button"
          data-testid="row-error-details-toggle"
          (click)="onToggleErrorDetails()"
        >
          {{ isErrorDetailsExpanded() ? 'Hide details' : 'Show details' }}
        </button>
        @if (isErrorDetailsExpanded()) {
          <pre
            class="basis-full whitespace-pre-wrap rounded bg-surface-muted px-2 py-1 font-mono text-xs text-foreground"
            data-testid="row-error-details"
            >{{ err.details }}</pre>
        }
      }
    }
    @if (r.mode === 'disk-backed') {
      <span class="font-mono text-xs text-foreground-muted" data-testid="row-index-dir">{{
        r.indexDir ?? ''
      }}</span>
      <span class="font-mono text-xs text-foreground-muted" data-testid="row-index-bytes">{{
        formatBytes(r.indexBytes)
      }}</span>
      <span
        class="font-mono text-xs text-foreground-muted"
        data-testid="row-manifest-version"
        >{{ r.manifestSparqlyVersion ?? '' }}</span
      >
      @if (r.state === 'stale' && r.staleReason) {
        <span
          class="rounded bg-warning-muted px-1.5 py-0.5 text-xs text-warning"
          data-testid="row-stale-reason"
          >{{ r.staleReason }}</span
        >
      }
    }
    @if (allowAdminActions() && r.mode === 'endpoint') {
      <button
        app-btn
        variant="secondary"
        size="sm"
        type="button"
        data-testid="row-action-test-connection"
        (click)="testConnection()"
      >
        Test connection
      </button>
      @if (probeChip(); as chip) {
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
    @if (allowAdminActions() && r.mode === 'disk-backed') {
      @if (r.state !== 'indexing') {
        <button
          app-btn
          variant="secondary"
          size="sm"
          type="button"
          data-testid="row-action-rebuild-index"
          (click)="rebuildIndex()"
        >
          {{ r.state === 'failed' ? 'Retry' : '(Re)build index' }}
        </button>
      }
      @if (r.state === 'indexing') {
        <button
          app-btn
          variant="secondary"
          size="sm"
          type="button"
          data-testid="row-action-cancel-build"
          (click)="cancelBuild()"
        >
          Cancel
        </button>
      }
    }
    @if (allowAdminActions() && r.mode !== 'endpoint' && r.children && hasLoadedChild(r)) {
      <button
        app-btn
        variant="secondary"
        size="sm"
        type="button"
        data-testid="row-action-reload-loaded-children"
        (click)="reloadLoadedChildren()"
      >
        Reload loaded children
      </button>
    }
    @if (allowAdminActions() && r.mode === 'in-memory') {
      @if (r.state === 'not-loaded' || r.state === 'failed') {
        <button
          app-btn
          variant="secondary"
          size="sm"
          type="button"
          data-testid="row-action-load"
          (click)="load()"
        >
          {{ r.state === 'failed' ? 'Retry' : 'Load' }}
        </button>
      }
      @if (r.state === 'loaded') {
        <button
          app-btn
          variant="secondary"
          size="sm"
          type="button"
          data-testid="row-action-reload"
          (click)="reload()"
        >
          Reload
        </button>
        <button
          app-btn
          variant="secondary"
          size="sm"
          type="button"
          data-testid="row-action-unload"
          (click)="unload()"
        >
          Unload
        </button>
      }
    }
  `,
})
export class SourceRowComponent {
  private readonly actions = inject(SourceActionsService);
  private readonly destroy = inject(DestroyRef);

  readonly row = input.required<SourceRow>();
  readonly allowAdminActions = input.required<boolean>();
  readonly expanded = input<boolean>(false);
  readonly toggleMeta = output<string>();

  readonly parentId = computed<string | undefined>(() => {
    const r = this.row();
    return r.mode === 'endpoint' ? undefined : r.parentId;
  });

  private readonly probeChipState = signal<EndpointProbeChip | undefined>(
    undefined,
  );
  readonly probeChip = this.probeChipState.asReadonly();

  private readonly errorDetailsOpen = signal(false);
  readonly isErrorDetailsExpanded = this.errorDetailsOpen.asReadonly();

  readonly hasLoadedChild = hasLoadedChild;
  readonly errorMessageFirstLine = errorMessageFirstLine;
  readonly formatBytes = formatBytes;

  onToggleMeta(): void {
    this.toggleMeta.emit(this.row().id);
  }

  onToggleErrorDetails(): void {
    this.errorDetailsOpen.update((v) => !v);
  }

  load(): void {
    this.fire(this.actions.load(this.row().id));
  }

  reload(): void {
    this.fire(this.actions.reload(this.row().id));
  }

  unload(): void {
    this.fire(this.actions.unload(this.row().id));
  }

  cancelBuild(): void {
    this.fire(this.actions.cancelBuild(this.row().id));
  }

  rebuildIndex(): void {
    const r = this.row();
    if (r.mode !== 'disk-backed') return;
    if (r.state === 'ready' || r.state === 'stale') {
      const ok = window.confirm(
        `Rebuild the Glob index for ${r.id}? The current index will be replaced once the new build completes.`,
      );
      if (!ok) return;
    }
    this.fire(this.actions.rebuildIndex(r.id));
  }

  // One POST per child so a failure doesn't stop siblings from being reloaded.
  reloadLoadedChildren(): void {
    for (const id of loadedChildIds(this.row())) {
      this.fire(this.actions.reload(id));
    }
  }

  testConnection(): void {
    this.probeChipState.set({ state: 'pending' });
    this.actions
      .testConnection(this.row().id)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (result) => {
          this.probeChipState.set(
            result.ok
              ? { state: 'ok', latencyMs: result.latencyMs }
              : {
                  state: 'error',
                  kind: result.error.kind,
                  message: result.error.message,
                },
          );
        },
        error: () => {
          this.probeChipState.set({
            state: 'error',
            kind: 'transport',
            message: 'probe request failed',
          });
        },
      });
  }

  private fire(obs: Observable<unknown>): void {
    obs.pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: () => {
        /* state arrives via SSE */
      },
      error: () => {
        /* surfaced on the next snapshot */
      },
    });
  }
}
