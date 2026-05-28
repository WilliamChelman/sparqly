import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  input,
  Output,
} from '@angular/core';
import { EyebrowComponent } from '@app/modules/eyebrow';
import type { CommitsResponse, RefsResponse } from './refs-api.client';
import { relativeDate } from './relative-date';

export type CommitsPanelState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; commits: CommitsResponse }
  | { kind: 'error'; kindLabel: string };

interface ScopeOptionGroup {
  readonly label: string;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
}

const ALL_REFS_VALUE = '__all__';

@Component({
  selector: 'app-commits-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col overflow-hidden' },
  template: `
    @let s = state();
    @if (s.kind !== 'idle') {
      <h3
        app-eyebrow
        data-section="commits"
        class="px-2.5 pb-1 pt-2"
      >Commits</h3>
      <div class="flex items-center gap-2 px-2.5 pb-1.5 pt-0.5">
        <label
          for="commits-scope"
          class="shrink-0 text-[11px] text-foreground-faint"
        >Commits on:</label>
        <select
          id="commits-scope"
          data-testid="commits-scope-select"
          class="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          [value]="scope()"
          (change)="onScopeChange($event)"
        >
          <option value="HEAD">HEAD</option>
          @for (group of scopeGroups(); track group.label) {
            <optgroup [attr.label]="group.label">
              @for (opt of group.options; track opt.value) {
                <option [value]="opt.value">{{ opt.label }}</option>
              }
            </optgroup>
          }
          <option [value]="allRefsValue">All refs</option>
        </select>
      </div>
    }
    @if (s.kind === 'loading') {
      <p
        data-testid="commits-loading"
        class="px-3 py-2 text-[12px] text-foreground-faint"
      >Loading commits…</p>
    }
    @if (s.kind === 'error') {
      <p
        data-testid="commits-error"
        class="px-3 py-2 text-[12px] text-foreground-muted"
      >Commits unavailable ({{ s.kindLabel }})</p>
    }
    @if (s.kind === 'loaded') {
      @if (s.commits.commits.length === 0) {
        <p
          data-testid="commits-empty-hint"
          class="px-3 py-2 text-[12px] text-foreground-muted"
        >
          No commits on <code class="font-mono">{{ scopeLabel() }}</code>
          touched this glob. Try scope:
          <button
            type="button"
            data-testid="commits-empty-hint-action"
            class="cursor-pointer text-accent underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            (click)="scopeChange.emit(allRefsValue)"
          >all refs</button>.
        </p>
      } @else {
        <ul class="list-none overflow-y-auto p-1.5">
          @for (c of s.commits.commits; track c.sha) {
            <li>
              <button
                type="button"
                [attr.data-commit-sha]="c.sha"
                class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground-muted hover:bg-surface-sunken hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                (click)="commitPicked.emit(c.sha)"
              >
                <span
                  class="shrink-0 font-mono text-[11px] text-foreground-faint"
                >{{ c.shortSha }}</span>
                <span class="min-w-0 flex-1 truncate">{{ c.subject }}</span>
                <span
                  class="shrink-0 text-[11px] text-foreground-faint"
                >· {{ c.authorName }} ·</span>
                <span
                  data-testid="commit-date"
                  [attr.title]="c.authorDate"
                  class="shrink-0 text-[11px] text-foreground-faint"
                >{{ relative(c.authorDate) }}</span>
              </button>
            </li>
          }
        </ul>
      }
    }
  `,
  imports: [EyebrowComponent],
})
export class CommitsPanelComponent {
  readonly state = input.required<CommitsPanelState>();
  readonly scope = input<string>('HEAD');
  readonly refs = input<RefsResponse | null>(null);
  readonly now = input<Date>(new Date());

  readonly allRefsValue = ALL_REFS_VALUE;

  readonly scopeGroups = computed<ReadonlyArray<ScopeOptionGroup>>(() => {
    const r = this.refs();
    if (r === null) return [];
    const groups: ScopeOptionGroup[] = [];
    if (r.branches.length > 0) {
      groups.push({
        label: 'Branches',
        options: r.branches.map((b) => ({ value: b.ref, label: b.ref })),
      });
    }
    const remoteGroups = new Map<string, Array<{ value: string; label: string }>>();
    for (const rb of r.remoteBranches) {
      const remote = rb.remote ?? 'origin';
      if (!remoteGroups.has(remote)) remoteGroups.set(remote, []);
      remoteGroups.get(remote)!.push({ value: rb.ref, label: rb.ref });
    }
    for (const [remote, options] of remoteGroups) {
      groups.push({ label: `Remote (${remote})`, options });
    }
    if (r.tags.length > 0) {
      groups.push({
        label: 'Tags',
        options: r.tags.map((t) => ({ value: t.ref, label: t.ref })),
      });
    }
    return groups;
  });

  readonly scopeLabel = computed<string>(() => {
    const s = this.scope();
    return s === ALL_REFS_VALUE ? 'all refs' : s;
  });

  @Output() readonly commitPicked = new EventEmitter<string>();
  @Output() readonly scopeChange = new EventEmitter<string>();

  relative(isoDate: string): string {
    return relativeDate(isoDate, this.now());
  }

  onScopeChange(ev: Event): void {
    const target = ev.target as HTMLSelectElement;
    this.scopeChange.emit(target.value);
  }
}
