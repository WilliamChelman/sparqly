import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { DEFAULT_PREFIXES, shortenNQuadLine } from 'common';
import type { DisplayContext } from '@app/core';
import type { Hunk, HunkLine } from '../services/diff.service';
import type { HunkClass } from '../utils/hunk-classifier';
import {
  collectAnchorSourceRanges,
  collectSnippetRanges,
  outerEnd,
  outerStart,
  type SnippetRange,
} from '../utils/source-snippet-ranges';
import { curieOrIri, shortenObjectTerm } from '../utils/term-display';
import { SourceSnippetComponent } from './source-snippet.component';

@Component({
  selector: 'app-diff-hunk',
  standalone: true,
  imports: [SourceSnippetComponent, NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
      @if (showSnippetArea()) {
        <div class="mt-2.5 flex flex-row flex-wrap gap-3">
          <div
            class="flex min-w-0 flex-1 basis-[280px] flex-col gap-1.5 rounded-md border border-removed-line bg-removed-bg p-2.5"
          >
            <div
              class="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-removed"
            >left</div>
            @if (leftRecords().length > 0) {
              @for (rec of leftRecords(); track outerStart(rec)) {
                <div data-testid="hunk-snippet">
                  <app-source-snippet
                    [file]="rec.file"
                    [focalStart]="outerStart(rec)"
                    [focalEnd]="outerEnd(rec)"
                    [records]="rec.records"
                    [context]="context()"
                  />
                </div>
              }
            } @else if (leftDefinedHere().length > 0) {
              <div
                data-testid="defined-here-left"
                class="font-mono text-[10px] italic text-foreground-faint"
              >defined here</div>
              @for (rec of leftDefinedHere(); track outerStart(rec)) {
                <div data-testid="hunk-snippet">
                  <app-source-snippet
                    [file]="rec.file"
                    [focalStart]="outerStart(rec)"
                    [focalEnd]="outerEnd(rec)"
                    [records]="rec.records"
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
              @for (rec of rightRecords(); track outerStart(rec)) {
                <div data-testid="hunk-snippet">
                  <app-source-snippet
                    [file]="rec.file"
                    [focalStart]="outerStart(rec)"
                    [focalEnd]="outerEnd(rec)"
                    [records]="rec.records"
                    [context]="context()"
                  />
                </div>
              }
            } @else if (rightDefinedHere().length > 0) {
              <div
                data-testid="defined-here-right"
                class="font-mono text-[10px] italic text-foreground-faint"
              >defined here</div>
              @for (rec of rightDefinedHere(); track outerStart(rec)) {
                <div data-testid="hunk-snippet">
                  <app-source-snippet
                    [file]="rec.file"
                    [focalStart]="outerStart(rec)"
                    [focalEnd]="outerEnd(rec)"
                    [records]="rec.records"
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

  readonly outerStart = outerStart;
  readonly outerEnd = outerEnd;

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

  private readonly definedHereRanges = computed<ReadonlyArray<SnippetRange>>(
    () => collectAnchorSourceRanges(this.hunk(), this.context()),
  );

  readonly leftRecords = computed<ReadonlyArray<SnippetRange>>(() =>
    this.ranges().filter((r) => r.side === 'left'),
  );
  readonly rightRecords = computed<ReadonlyArray<SnippetRange>>(() =>
    this.ranges().filter((r) => r.side === 'right'),
  );
  readonly leftDefinedHere = computed<ReadonlyArray<SnippetRange>>(() =>
    this.definedHereRanges().filter((r) => r.side === 'left'),
  );
  readonly rightDefinedHere = computed<ReadonlyArray<SnippetRange>>(() =>
    this.definedHereRanges().filter((r) => r.side === 'right'),
  );

  /**
   * The per-side snippet panels render only when there is something to put in
   * them — a changed-line snippet on either side, or an anchor definition site.
   * With no `annotateSource` transformation there are no source records at all,
   * so the panels stay hidden, matching the pre-source-records diff.
   */
  readonly showSnippetArea = computed<boolean>(
    () =>
      this.leftRecords().length > 0 ||
      this.rightRecords().length > 0 ||
      this.definedHereRanges().length > 0,
  );

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
