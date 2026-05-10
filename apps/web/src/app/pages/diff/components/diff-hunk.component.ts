import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { DEFAULT_PREFIXES, shortenNQuadLine } from 'common';
import type { DisplayContext } from '@app/core';
import type { Hunk, HunkLine, SourceRecord } from '../services/diff.service';
import type { HunkClass } from '../utils/hunk-classifier';
import {
  collectSnippetRanges,
  type SnippetRange,
} from '../utils/source-snippet-ranges';
import { curieOrIri, shortenObjectTerm } from '../utils/term-display';
import { SourceSnippetComponent } from './source-snippet.component';

interface RenderedChip {
  readonly side: 'left' | 'right';
  readonly text: string;
  readonly anchorId: string;
}

@Component({
  selector: 'app-diff-hunk',
  standalone: true,
  imports: [SourceSnippetComponent, NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .my-hunk-chip-left::before {
        content: '−';
        color: var(--teal);
        margin-right: 6px;
      }
      .my-hunk-chip-right::before {
        content: '+';
        color: var(--gold);
        margin-right: 6px;
      }
    `,
  ],
  template: `
    <article
      data-testid="hunk"
      [attr.data-state]="cls()"
      class="relative my-3 rounded-r-md border-l-2 py-3.5 pl-[22px] pr-4"
      [ngClass]="stateClasses()"
    >
      <header
        data-testid="hunk-header"
        class="mb-2 flex flex-wrap items-center gap-2.5 font-mono text-xs"
      >
        <span class="break-all font-semibold text-foreground">{{ anchorDisplay() }}</span>
        @if (rdfTypeDisplay(); as t) {
          <span class="text-foreground-muted text-[11px]">({{ t }})</span>
        }
        <span class="ml-auto text-[11px] text-foreground-faint">{{ countsLabel() }}</span>
      </header>
      <div
        data-testid="hunk-body"
        class="overflow-x-auto font-mono text-xs leading-[1.45]"
      >
        @for (line of hunk().lines; track $index) {
          @if (line.side === '-') {
            <span
              data-testid="removed-line"
              class="block w-max min-w-full rounded-[3px] bg-removed-bg px-1.5 py-px whitespace-pre text-foreground"
            >- {{ formatLineBody(line) }}</span>
          } @else {
            <span
              data-testid="added-line"
              class="block w-max min-w-full rounded-[3px] bg-added-bg px-1.5 py-px whitespace-pre text-foreground"
            >+ {{ formatLineBody(line) }}</span>
          }
        }
      </div>
      @if (chips().length > 0) {
        <div data-testid="hunk-chips" class="mt-2 flex flex-wrap gap-1.5">
          @for (chip of chips(); track $index) {
            <a
              class="rounded-full border border-border bg-surface px-2 py-[3px] font-mono text-[10px] text-foreground-muted no-underline transition-colors hover:border-foreground-faint hover:text-foreground"
              [class.my-hunk-chip-left]="chip.side === 'left'"
              [class.my-hunk-chip-right]="chip.side === 'right'"
              [attr.data-testid]="'hunk-chip-' + chip.side"
              [attr.href]="'#' + chip.anchorId"
            >{{ chip.text }}</a>
          }
        </div>
      }
      @if (leftRecords().length > 0 || rightRecords().length > 0) {
        <div class="mt-2.5 flex flex-row flex-wrap gap-3">
          <div
            class="flex min-w-0 flex-1 basis-[280px] flex-col gap-1.5 rounded-md border border-removed-line bg-removed-bg p-2.5"
          >
            <div
              class="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-removed"
            >left</div>
            @if (leftRecords().length > 0) {
              @for (rec of leftRecords(); track rec.anchorIds[0]) {
                <div data-testid="hunk-snippet">
                  @for (aid of rec.anchorIds; track aid) {
                    <span [attr.id]="aid"></span>
                  }
                  <app-source-snippet
                    [file]="rec.file"
                    [focalStart]="rec.focalStart"
                    [focalEnd]="rec.focalEnd"
                    [context]="context()"
                  />
                </div>
              }
            } @else {
              <p
                data-testid="hunk-snippet-placeholder-left"
                class="m-0 font-serif text-xs italic text-foreground-faint"
              >(absent on left)</p>
            }
          </div>
          <div
            class="flex min-w-0 flex-1 basis-[280px] flex-col gap-1.5 rounded-md border border-added-line bg-added-bg p-2.5"
          >
            <div
              class="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-added"
            >right</div>
            @if (rightRecords().length > 0) {
              @for (rec of rightRecords(); track rec.anchorIds[0]) {
                <div data-testid="hunk-snippet">
                  @for (aid of rec.anchorIds; track aid) {
                    <span [attr.id]="aid"></span>
                  }
                  <app-source-snippet
                    [file]="rec.file"
                    [focalStart]="rec.focalStart"
                    [focalEnd]="rec.focalEnd"
                    [context]="context()"
                  />
                </div>
              }
            } @else {
              <p
                data-testid="hunk-snippet-placeholder-right"
                class="m-0 font-serif text-xs italic text-foreground-faint"
              >(absent on right)</p>
            }
          </div>
        </div>
      }
    </article>
  `,
})
export class DiffHunkComponent {
  readonly hunk = input.required<Hunk>();
  readonly cls = input.required<HunkClass>();
  readonly context = input<number>(3);
  readonly displayContext = input<DisplayContext>({ prefixes: {} });

  private readonly prefixes = computed<Record<string, string>>(() => ({
    ...DEFAULT_PREFIXES,
    ...this.displayContext().prefixes,
  }));

  private readonly prefixEntries = computed<ReadonlyArray<[string, string]>>(
    () => Object.entries(this.prefixes()),
  );

  readonly anchorDisplay = computed(() => {
    const h = this.hunk();
    return h.orphan === true
      ? h.anchor
      : curieOrIri(h.anchor, this.prefixEntries(), this.displayContext().base);
  });

  readonly rdfTypeDisplay = computed<string | null>(() => {
    const h = this.hunk();
    return h.rdfType !== undefined
      ? curieOrIri(h.rdfType, this.prefixEntries(), this.displayContext().base)
      : null;
  });

  readonly countsLabel = computed(() => {
    const h = this.hunk();
    return `[-${h.removed} +${h.added}]`;
  });

  private readonly ranges = computed<ReadonlyArray<SnippetRange>>(() =>
    collectSnippetRanges(this.hunk(), this.context()),
  );

  readonly leftRecords = computed<ReadonlyArray<SnippetRange>>(() =>
    this.ranges().filter((r) => r.side === 'left'),
  );
  readonly rightRecords = computed<ReadonlyArray<SnippetRange>>(() =>
    this.ranges().filter((r) => r.side === 'right'),
  );

  readonly chips = computed<ReadonlyArray<RenderedChip>>(() => {
    const h = this.hunk();
    const out: RenderedChip[] = [];
    for (const r of h.sourceRecords.left) out.push(chipFor(r, 'left'));
    for (const r of h.sourceRecords.right) out.push(chipFor(r, 'right'));
    return out;
  });

  readonly stateClasses = computed<Record<string, boolean>>(() => {
    const c = this.cls();
    return {
      'border-l-accent': c === 'changed' || c === 'added',
      'border-l-secondary': c === 'removed',
      'bg-accent-soft/10': c === 'changed',
      'bg-added-bg': c === 'added',
      'bg-removed-bg': c === 'removed',
    };
  });

  formatLineBody(line: HunkLine): string {
    const entries = this.prefixEntries();
    const base = this.displayContext().base;
    if (line.listItems !== undefined) {
      const predicate = curieOrIri(line.predicate, entries, base);
      const items = line.listItems.map((item) =>
        shortenObjectTerm(item, entries, base),
      );
      return `${predicate} ( ${items.join(' ')} )`;
    }
    const shortened = shortenNQuadLine(line.nquad, {
      prefixes: this.prefixes(),
      base,
    });
    const prefix = `${this.anchorDisplay()} `;
    return shortened.startsWith(prefix)
      ? shortened.slice(prefix.length)
      : shortened;
  }
}

function chipFor(record: SourceRecord, side: 'left' | 'right'): RenderedChip {
  const base = baseName(record.file);
  const anchorId = record.line === undefined ? base : `${base}-L${record.line}`;
  const text = record.line === undefined ? base : `${base}:${record.line}`;
  return { side, text, anchorId };
}

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}
