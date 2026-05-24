/* eslint-disable @angular-eslint/component-selector */
// ADR-0034 precedent: attribute component on the consumer's existing `<li>`,
// so the card stays a single grid item with no extra wrapper that would break
// the layout or the test `querySelector` chains.
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
import { IconDisclosureComponent } from '@app/modules/icons';
import { SourceActionsService } from './source-actions.service';
import type { EndpointProbeChip, SourceRow } from './source-row';

type CardKind = 'endpoint' | 'in-memory-glob' | 'disk-backed' | 'other';

@Component({
  selector: 'li[app-source-card]',
  standalone: true,
  imports: [DatePipe, ButtonComponent, IconDisclosureComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'flex flex-col gap-2 rounded-md border border-border-muted bg-surface p-3 shadow-sm',
    '[class.border-warning]': 'hasError()',
    // Visual group cue: child cards and expanded-parent cards share an accent
    // left edge so the parent↔children link is obvious even in the flat grid.
    '[class.border-l-4]': 'isChild() || hasExpandedChildren()',
    '[class.border-l-accent-muted]': 'isChild() || hasExpandedChildren()',
    '[class.md:ml-6]': 'isChild()',
    '[attr.data-testid]': '"source-row-" + row().id',
  },
  template: `
    @let r = row();
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-base" [class]="kindIconClasses()">{{ kindIcon() }}</span>
      <span class="font-mono text-sm text-foreground">{{ r.id }}</span>
      @if (r.default === true) {
        <span class="text-accent" title="default">★</span>
      }
      <span
        class="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-foreground-muted"
        data-testid="row-kind"
      >{{ r.kind }}</span>
      @if (parentId(); as pid) {
        <span class="font-mono text-[10px] text-foreground-faint">↳ {{ pid }}</span>
      }
      @if (r.mode !== 'endpoint') {
        <span
          class="ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] uppercase"
          data-testid="row-state"
          [class]="stateClasses(r.state)"
        >{{ r.state }}</span>
      } @else {
        <span class="ml-auto font-mono text-[10px] uppercase text-foreground-faint">remote</span>
      }
      @if (r.mode !== 'endpoint' && r.children) {
        <button
          app-btn
          variant="icon"
          size="sm"
          type="button"
          class="text-base"
          [attr.aria-expanded]="expanded()"
          [attr.aria-label]="expanded() ? 'Collapse children' : 'Expand children'"
          (click)="onToggleMeta()"
        ><app-icon-disclosure [expanded]="expanded()" /></button>
      }
    </div>

    @if (r.mode === 'endpoint' && r.endpointUrl) {
      <a
        class="break-all font-mono text-xs text-accent underline decoration-dotted"
        [href]="r.endpointUrl"
        target="_blank"
        rel="noreferrer"
      >{{ r.endpointUrl }}</a>
    }

    @if (r.mode !== 'endpoint') {
      <dl
        class="grid gap-1 text-xs"
        [class.grid-cols-4]="r.mode === 'in-memory'"
        [class.grid-cols-3]="r.mode === 'disk-backed'"
      >
        <div>
          <dt class="text-foreground-faint">quads</dt>
          <dd class="font-mono">{{ r.quads ?? '' }}</dd>
        </div>
        <div>
          <dt class="text-foreground-faint">files</dt>
          <dd class="font-mono">{{ r.files ?? '' }}</dd>
        </div>
        <div>
          <dt class="text-foreground-faint">last load</dt>
          <dd class="font-mono">
            {{ r.loadedAt ? (r.loadedAt | date: 'short') : '' }}
          </dd>
        </div>
        <div>
          <dt class="text-foreground-faint">load ms</dt>
          <dd class="font-mono">
            {{ r.loadMs !== undefined ? r.loadMs + ' ms' : '' }}
          </dd>
        </div>
      </dl>
    }

    @if (r.mode === 'disk-backed') {
      <dl class="grid grid-cols-3 gap-1 text-xs">
        <div>
          <dt class="text-foreground-faint">index</dt>
          <dd class="break-all font-mono">{{ r.indexDir ?? '' }}</dd>
        </div>
        <div>
          <dt class="text-foreground-faint">size</dt>
          <dd class="font-mono">{{ formatBytes(r.indexBytes) }}</dd>
        </div>
        <div>
          <dt class="text-foreground-faint">version</dt>
          <dd class="font-mono">
            {{ r.manifestSparqlyVersion ?? '' }}
          </dd>
        </div>
      </dl>
      @if (r.state === 'stale' && r.staleReason) {
        <p
          class="rounded bg-warning-muted px-1.5 py-1 text-xs text-warning"
          data-testid="row-stale-reason"
        >{{ r.staleReason }}</p>
      }
    }

    @if (r.mode !== 'endpoint' && r.state === 'failed' && r.error; as err) {
      <p
        class="rounded bg-warning-muted px-1.5 py-1 text-xs text-warning"
        data-testid="row-error-chip"
        [attr.data-kind]="err.kind"
      >{{ err.kind }} · {{ errorMessageFirstLine(err.message) }}</p>
      @if (err.details) {
        <button
          app-btn
          variant="secondary"
          size="sm"
          type="button"
          (click)="onToggleErrorDetails()"
        >{{ isErrorDetailsExpanded() ? 'Hide details' : 'Show details' }}</button>
        @if (isErrorDetailsExpanded()) {
          <pre
            class="whitespace-pre-wrap rounded bg-surface-muted px-2 py-1 font-mono text-xs text-foreground"
            data-testid="row-error-details"
          >{{ err.details }}</pre>
        }
      }
    }

    @if (probeChip(); as chip) {
      <span
        class="rounded px-1.5 py-0.5 font-mono text-xs"
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

    @if (allowAdminActions() && actions().length > 0) {
      <div class="mt-auto flex flex-wrap gap-1 pt-1">
        @for (a of actions(); track a.label) {
          <button
            app-btn
            variant="secondary"
            size="sm"
            type="button"
            (click)="a.run()"
          >{{ a.label }}</button>
        }
      </div>
    }
  `,
})
export class SourceCardComponent {
  private readonly actionService = inject(SourceActionsService);
  private readonly destroy = inject(DestroyRef);

  readonly row = input.required<SourceRow>();
  readonly allowAdminActions = input.required<boolean>();
  readonly expanded = input<boolean>(false);
  readonly toggleMeta = output<string>();

  readonly parentId = computed<string | undefined>(() => {
    const r = this.row();
    return r.mode === 'endpoint' ? undefined : r.parentId;
  });

  readonly hasError = computed<boolean>(() => {
    const r = this.row();
    return r.mode !== 'endpoint' && r.state === 'failed';
  });

  readonly isChild = computed<boolean>(() => this.parentId() !== undefined);

  readonly hasExpandedChildren = computed<boolean>(() => {
    const r = this.row();
    return r.mode !== 'endpoint' && r.children !== undefined && this.expanded();
  });

  private readonly probeChipState = signal<EndpointProbeChip | undefined>(
    undefined,
  );
  readonly probeChip = this.probeChipState.asReadonly();

  private readonly errorDetailsOpen = signal(false);
  readonly isErrorDetailsExpanded = this.errorDetailsOpen.asReadonly();

  errorMessageFirstLine(message: string): string {
    const newline = message.indexOf('\n');
    return newline === -1 ? message : message.slice(0, newline);
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

  readonly cardKind = computed<CardKind>(() => {
    const r = this.row();
    if (r.mode === 'endpoint') return 'endpoint';
    if (r.mode === 'disk-backed') return 'disk-backed';
    if (r.mode === 'in-memory' && r.kind === 'glob') return 'in-memory-glob';
    return 'other';
  });

  kindIcon(): string {
    switch (this.cardKind()) {
      case 'endpoint': return '◉';
      case 'in-memory-glob': return '◆';
      case 'disk-backed': return '▣';
      case 'other': return '○';
    }
  }

  kindIconClasses(): string {
    switch (this.cardKind()) {
      case 'endpoint': return 'text-accent';
      case 'in-memory-glob': return 'text-foreground';
      case 'disk-backed': return 'text-foreground-muted';
      case 'other': return 'text-foreground-faint';
    }
  }

  stateClasses(state: string): string {
    switch (state) {
      case 'loaded':
      case 'ready':
        return 'bg-accent-muted text-accent';
      case 'failed':
      case 'stale':
        return 'bg-warning-muted text-warning';
      case 'loading':
      case 'indexing':
        return 'bg-surface-muted text-foreground';
      default:
        return 'bg-surface-muted text-foreground-muted';
    }
  }

  readonly actions = computed<
    ReadonlyArray<{ label: string; run: () => void }>
  >(() => {
    if (!this.allowAdminActions()) return [];
    const r = this.row();
    const acts: { label: string; run: () => void }[] = [];
    if (r.mode === 'endpoint') {
      acts.push({
        label: 'Test connection',
        run: () => this.testConnection(),
      });
      return acts;
    }
    if (r.mode === 'in-memory') {
      if (r.state === 'not-loaded' || r.state === 'failed') {
        acts.push({
          label: r.state === 'failed' ? 'Retry' : 'Load',
          run: () => this.load(),
        });
      } else if (r.state === 'loaded') {
        acts.push({ label: 'Reload', run: () => this.reload() });
        acts.push({ label: 'Unload', run: () => this.unload() });
      }
    }
    if (r.mode === 'disk-backed') {
      if (r.state === 'indexing') {
        acts.push({
          label: 'Cancel',
          run: () => this.cancelBuild(),
        });
      } else {
        acts.push({
          label: r.state === 'failed' ? 'Retry' : '(Re)build index',
          run: () => this.rebuildIndex(),
        });
      }
    }
    if (r.children && this.hasLoadedChild(r)) {
      acts.push({
        label: 'Reload loaded children',
        run: () => this.reloadLoadedChildren(),
      });
    }
    return acts;
  });

  onToggleMeta(): void {
    this.toggleMeta.emit(this.row().id);
  }

  onToggleErrorDetails(): void {
    this.errorDetailsOpen.update((v) => !v);
  }

  private load(): void {
    this.fire(this.actionService.load(this.row().id));
  }

  private reload(): void {
    this.fire(this.actionService.reload(this.row().id));
  }

  private unload(): void {
    this.fire(this.actionService.unload(this.row().id));
  }

  private cancelBuild(): void {
    this.fire(this.actionService.cancelBuild(this.row().id));
  }

  private rebuildIndex(): void {
    const r = this.row();
    if (r.mode !== 'disk-backed') return;
    if (r.state === 'ready' || r.state === 'stale') {
      const ok = window.confirm(
        `Rebuild the Glob index for ${r.id}? The current index will be replaced once the new build completes.`,
      );
      if (!ok) return;
    }
    this.fire(this.actionService.rebuildIndex(r.id));
  }

  // One POST per child so a failure doesn't stop siblings from being reloaded.
  private reloadLoadedChildren(): void {
    for (const id of this.loadedChildIds(this.row())) {
      this.fire(this.actionService.reload(id));
    }
  }

  private hasLoadedChild(row: SourceRow): boolean {
    if (row.mode === 'endpoint') return false;
    const children = row.children;
    if (children === undefined) return false;
    for (const c of children) {
      if (c.mode === 'endpoint') continue;
      if (c.state === 'loaded' || c.state === 'ready') return true;
    }
    return false;
  }

  private loadedChildIds(row: SourceRow): string[] {
    if (row.mode === 'endpoint') return [];
    const children = row.children;
    if (children === undefined) return [];
    const ids: string[] = [];
    for (const c of children) {
      if (c.mode === 'endpoint') continue;
      if (c.state === 'loaded' || c.state === 'ready') ids.push(c.id);
    }
    return ids;
  }

  private testConnection(): void {
    this.probeChipState.set({ state: 'pending' });
    this.actionService
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
