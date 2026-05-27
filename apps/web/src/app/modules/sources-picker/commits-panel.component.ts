import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  input,
  Output,
} from '@angular/core';
import { EyebrowComponent } from '@app/modules/eyebrow';
import type { CommitsResponse } from './refs-api.client';
import { relativeDate } from './relative-date';

export type CommitsPanelState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; commits: CommitsResponse }
  | { kind: 'error'; kindLabel: string };

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
  `,
  imports: [EyebrowComponent],
})
export class CommitsPanelComponent {
  readonly state = input.required<CommitsPanelState>();
  readonly now = input<Date>(new Date());

  @Output() readonly commitPicked = new EventEmitter<string>();

  relative(isoDate: string): string {
    return relativeDate(isoDate, this.now());
  }
}
