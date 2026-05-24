import {
  ChangeDetectionStrategy,
  Component,
  input,
  model,
} from '@angular/core';

export type SourceStateFilter =
  | 'all'
  | 'loaded'
  | 'ready'
  | 'not-loaded'
  | 'not-built'
  | 'failed'
  | 'stale'
  | 'loading'
  | 'indexing'
  | 'endpoint';

export type SourceFilterCounts = Record<SourceStateFilter, number>;

@Component({
  selector: 'app-source-filter-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-wrap items-center gap-2' },
  template: `
    <input
      type="search"
      class="w-64 rounded-md border border-border-muted bg-surface px-2 py-1 text-sm text-foreground placeholder:text-foreground-faint"
      placeholder="Filter by id…"
      [value]="query()"
      (input)="query.set($any($event.target).value)"
    />
    @for (f of FILTERS; track f.key) {
      <button
        type="button"
        class="cursor-pointer rounded-full border border-border-muted px-2 py-0.5 text-xs"
        [attr.aria-pressed]="state() === f.key"
        [class.bg-foreground]="state() === f.key"
        [class.text-surface]="state() === f.key"
        [class.text-foreground-muted]="state() !== f.key"
        (click)="state.set(f.key)"
      >
        {{ f.label }}
        <span class="ml-1 font-mono text-[10px] opacity-70">{{ counts()[f.key] }}</span>
      </button>
    }
    <span class="ml-auto font-mono text-xs text-foreground-muted">
      {{ visibleCount() }} / {{ counts().all }}
    </span>
  `,
})
export class SourceFilterBarComponent {
  readonly query = model<string>('');
  readonly state = model<SourceStateFilter>('all');
  readonly counts = input.required<SourceFilterCounts>();
  readonly visibleCount = input.required<number>();

  // Stable list — surfaced as a constant so the template binding doesn't
  // re-create the array on every change detection cycle.
  readonly FILTERS: ReadonlyArray<{ key: SourceStateFilter; label: string }> = [
    { key: 'all', label: 'all' },
    { key: 'loaded', label: 'loaded' },
    { key: 'ready', label: 'ready' },
    { key: 'not-loaded', label: 'not loaded' },
    { key: 'not-built', label: 'not built' },
    { key: 'failed', label: 'failed' },
    { key: 'stale', label: 'stale' },
    { key: 'loading', label: 'loading' },
    { key: 'indexing', label: 'indexing' },
    { key: 'endpoint', label: 'endpoints' },
  ];
}
