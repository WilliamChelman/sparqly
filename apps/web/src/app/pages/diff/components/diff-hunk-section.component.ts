import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { DisplayContext } from '@app/core';
import type { Hunk } from '../services/diff.service';
import type { HunkClass } from '../utils/hunk-classifier';
import { DiffHunkComponent } from './diff-hunk.component';

export interface ClassifiedHunk {
  readonly hunk: Hunk;
  readonly cls: HunkClass;
}

@Component({
  selector: 'app-diff-hunk-section',
  standalone: true,
  imports: [DiffHunkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section [attr.data-testid]="testid()" class="mt-2">
      <div
        class="mb-2 flex items-baseline justify-between border-b border-dashed border-border-muted pb-2 pt-4"
      >
        <h3
          class="m-0 font-serif text-lg font-medium italic text-foreground [font-variation-settings:'opsz'_36]"
        >{{ title() }}</h3>
        <span
          data-testid="section-count"
          class="font-mono text-[11px] uppercase tracking-[0.12em] text-foreground-faint"
        >{{ countLabel() }}</span>
      </div>
      @if (hunks().length === 0) {
        <p
          data-testid="section-empty"
          class="my-2 font-serif text-sm italic text-foreground-faint"
        >(none)</p>
      }
      @for (rh of hunks(); track rh.hunk.anchor) {
        <app-diff-hunk
          [hunk]="rh.hunk"
          [cls]="rh.cls"
          [context]="context()"
          [displayContext]="displayContext()"
        />
      }
    </section>
  `,
})
export class DiffHunkSectionComponent {
  readonly testid = input.required<string>();
  readonly title = input.required<string>();
  readonly hunks = input.required<ReadonlyArray<ClassifiedHunk>>();
  readonly context = input<number>(3);
  readonly displayContext = input<DisplayContext>({ prefixes: {} });

  countLabel(): string {
    const n = this.hunks().length;
    if (n === 0) return '(none)';
    return `${n} ${n === 1 ? 'hunk' : 'hunks'}`;
  }
}
