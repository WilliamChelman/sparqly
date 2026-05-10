import { NgClass, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { bestPrefixEntryFor, DEFAULT_PREFIXES, shortenNQuadLine } from 'common';
import type { DisplayContext } from '@app/core';
import type {
  DiffResponse,
  GroupedDiffResponse,
  Hunk,
  HunkLine,
  SourceRecord,
  TabularDiffEntry,
  TabularDiffResponse,
  TabularTerm,
} from '../services/diff.service';
import { classifyHunk, type HunkClass } from '../utils/hunk-classifier';
import { SourceSnippetComponent } from './source-snippet.component';

interface RenderedChip {
  side: 'left' | 'right';
  text: string;
  anchorId: string;
}

interface DedupedRecord {
  file: string;
  focalStart: number;
  focalEnd: number;
  anchorId: string;
  side: 'left' | 'right';
}

interface RenderedHunk {
  hunk: Hunk;
  cls: HunkClass;
  anchorDisplay: string;
  rdfTypeDisplay: string | null;
  countsLabel: string;
  lines: ReadonlyArray<HunkLine>;
  chips: ReadonlyArray<RenderedChip>;
  leftRecords: ReadonlyArray<DedupedRecord>;
  rightRecords: ReadonlyArray<DedupedRecord>;
}

@Component({
  selector: 'app-diff-result-renderer',
  standalone: true,
  imports: [SourceSnippetComponent, NgTemplateOutlet, NgClass],
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
    @if (totalsLine(); as line) {
      <p
        data-testid="diff-totals"
        class="flex flex-wrap items-center gap-3.5 rounded-lg border border-border-muted bg-surface-sunken px-[18px] py-3 font-mono text-xs text-foreground-muted"
      >
        <span class="inline-flex items-center gap-1.5 text-foreground-faint">
          <span class="text-accent">✦</span>
          <span>───</span>
          <span class="text-secondary">✧</span>
        </span>
        {{ line }}
      </p>
    }
    @if (tabularView(); as t) {
      <div
        class="overflow-hidden rounded-lg border border-border-muted bg-surface"
      >
        <table
          data-testid="tabular-diff"
          class="w-full border-collapse font-mono text-xs [&_td]:border-b [&_td]:border-border-muted [&_td]:px-3 [&_td]:py-[7px] [&_td]:text-left [&_th]:border-b [&_th]:border-border-muted [&_th]:px-3 [&_th]:py-[7px] [&_th]:text-left [&_thead_th]:bg-surface-sunken [&_thead_th]:font-sans [&_thead_th]:text-[10px] [&_thead_th]:uppercase [&_thead_th]:tracking-[0.14em] [&_thead_th]:text-foreground-faint"
        >
          <thead>
            <tr>
              <th class="w-[26px] text-center">side</th>
              <th>count</th>
              @for (v of t.variables; track v) {
                <th>{{ v }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (e of tabularRows(t); track $index) {
              <tr
                [attr.data-side]="e.side"
                [class.bg-added-bg]="e.side === '+'"
                [class.bg-removed-bg]="e.side === '-'"
              >
                <td
                  class="w-[26px] text-center font-semibold"
                  [class.text-accent-strong]="e.side === '+'"
                  [class.dark:text-accent]="e.side === '+'"
                  [class.text-secondary-strong]="e.side === '-'"
                  [class.dark:text-secondary]="e.side === '-'"
                >{{ e.side === '+' ? '✦' : '✧' }}</td>
                <td>{{ e.entry.count }}</td>
                @for (v of t.variables; track v) {
                  <td>{{ termText(e.entry.row[v]) }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
    @if (groupedView(); as g) {
      <ng-container
        *ngTemplateOutlet="
          sectionTpl;
          context: {
            testid: 'section-changed',
            title: 'Changed',
            hunks: changedRendered(),
            count: changedRendered().length,
          }
        "
      />
      <ng-container
        *ngTemplateOutlet="
          sectionTpl;
          context: {
            testid: 'section-added',
            title: 'Added',
            hunks: addedRendered(),
            count: addedRendered().length,
          }
        "
      />
      <ng-container
        *ngTemplateOutlet="
          sectionTpl;
          context: {
            testid: 'section-removed',
            title: 'Removed',
            hunks: removedRendered(),
            count: removedRendered().length,
          }
        "
      />

      <ng-template
        #sectionTpl
        let-testid="testid"
        let-title="title"
        let-hunks="hunks"
        let-count="count"
      >
        <section [attr.data-testid]="testid" class="mt-2">
          <div
            class="mb-2 flex items-baseline justify-between border-b border-dashed border-border-muted pb-2 pt-4"
          >
            <h3
              class="m-0 font-serif text-lg font-medium italic text-foreground [font-variation-settings:'opsz'_36]"
            >{{ title }}</h3>
            <span
              data-testid="section-count"
              class="font-mono text-[11px] uppercase tracking-[0.12em] text-foreground-faint"
            >{{ count === 0 ? '(none)' : count + (count === 1 ? ' hunk' : ' hunks') }}</span>
          </div>
          @if (hunks.length === 0) {
            <p
              data-testid="section-empty"
              class="my-2 font-serif text-sm italic text-foreground-faint"
            >(none)</p>
          }
          @for (rh of hunks; track rh.hunk.anchor) {
            <ng-container *ngTemplateOutlet="hunkTpl; context: { $implicit: rh }" />
          }
        </section>
      </ng-template>

      <ng-template #hunkTpl let-rh>
        <article
          data-testid="hunk"
          [attr.data-state]="rh.cls"
          class="relative my-3 rounded-r-md border-l-2 py-3.5 pl-[22px] pr-4"
          [ngClass]="hunkStateClasses(rh.cls)"
        >
          <header
            data-testid="hunk-header"
            class="mb-2 flex flex-wrap items-center gap-2.5 font-mono text-xs"
          >
            <span class="break-all font-semibold text-foreground">{{ rh.anchorDisplay }}</span>
            @if (rh.rdfTypeDisplay) {
              <span class="text-foreground-muted text-[11px]">({{ rh.rdfTypeDisplay }})</span>
            }
            <span class="ml-auto text-[11px] text-foreground-faint">{{ rh.countsLabel }}</span>
          </header>
          <div
            data-testid="hunk-body"
            class="overflow-x-auto font-mono text-xs leading-[1.45]"
          >
            @for (line of rh.lines; track $index) {
              <ng-container
                *ngTemplateOutlet="lineTpl; context: { $implicit: line, rh: rh }"
              />
            }
          </div>
          @if (rh.chips.length > 0) {
            <div data-testid="hunk-chips" class="mt-2 flex flex-wrap gap-1.5">
              @for (chip of rh.chips; track $index) {
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
          @if (rh.leftRecords.length > 0 || rh.rightRecords.length > 0) {
            <div class="mt-2.5 flex flex-col gap-3">
              @if (rh.leftRecords.length > 0) {
                <div
                  class="flex flex-col gap-1.5 rounded-md border border-removed-line bg-removed-bg p-2.5"
                >
                  <div
                    class="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-removed"
                  >left</div>
                  @for (rec of rh.leftRecords; track rec.anchorId) {
                    <div
                      [attr.id]="rec.anchorId"
                      data-testid="hunk-snippet"
                    >
                      <app-source-snippet
                        [file]="rec.file"
                        [focalStart]="rec.focalStart"
                        [focalEnd]="rec.focalEnd"
                        [context]="context()"
                      />
                    </div>
                  }
                </div>
              }
              @if (rh.rightRecords.length > 0) {
                <div
                  class="flex flex-col gap-1.5 rounded-md border border-added-line bg-added-bg p-2.5"
                >
                  <div
                    class="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-added"
                  >right</div>
                  @for (rec of rh.rightRecords; track rec.anchorId) {
                    <div
                      [attr.id]="rec.anchorId"
                      data-testid="hunk-snippet"
                    >
                      <app-source-snippet
                        [file]="rec.file"
                        [focalStart]="rec.focalStart"
                        [focalEnd]="rec.focalEnd"
                        [context]="context()"
                      />
                    </div>
                  }
                </div>
              }
            </div>
          }
        </article>
      </ng-template>

      <ng-template #lineTpl let-line let-rh="rh">
        @if (line.side === '-') {
          <span
            data-testid="removed-line"
            class="block w-max min-w-full rounded-[3px] bg-removed-bg px-1.5 py-px whitespace-pre text-foreground"
          >- {{ formatLineBody(line, rh) }}</span>
        } @else {
          <span
            data-testid="added-line"
            class="block w-max min-w-full rounded-[3px] bg-added-bg px-1.5 py-px whitespace-pre text-foreground"
          >+ {{ formatLineBody(line, rh) }}</span>
        }
      </ng-template>
    }
    @if (result().kind === 'error') {
      @let errs = errorView();
      @if (errs?.top) {
        <p
          data-testid="error-top"
          class="flex items-start gap-2.5 rounded-lg border border-error-line bg-error-bg px-3.5 py-3 font-mono text-xs text-error"
        >{{ errs?.top }}</p>
      }
      <div class="grid grid-cols-2 gap-4">
        @if (errs?.left) {
          <p
            data-testid="error-left"
            class="flex items-start gap-2.5 rounded-lg border border-error-line bg-error-bg px-3.5 py-3 font-mono text-xs text-error"
          >{{ errs?.left }}</p>
        }
        @if (errs?.right) {
          <p
            data-testid="error-right"
            class="flex items-start gap-2.5 rounded-lg border border-error-line bg-error-bg px-3.5 py-3 font-mono text-xs text-error"
          >{{ errs?.right }}</p>
        }
      </div>
    }
  `,
})
export class DiffResultRendererComponent {
  readonly result = input.required<DiffResponse>();
  readonly context = input<number>(3);
  readonly displayContext = input<DisplayContext>({ prefixes: {} });

  readonly effectivePrefixes = computed<Record<string, string>>(() => ({
    ...DEFAULT_PREFIXES,
    ...this.displayContext().prefixes,
  }));

  readonly effectiveBase = computed<string | undefined>(
    () => this.displayContext().base,
  );

  readonly errorView = computed(() => {
    const r = this.result();
    return r.kind === 'error' ? r.errors : null;
  });

  readonly groupedView = computed<GroupedDiffResponse | null>(() => {
    const r = this.result();
    return r.kind === 'grouped' ? r : null;
  });

  readonly tabularView = computed<TabularDiffResponse | null>(() => {
    const r = this.result();
    return r.kind === 'tabular' ? r : null;
  });

  readonly allHunks = computed<ReadonlyArray<Hunk>>(() => {
    const g = this.groupedView();
    if (g === null) return [];
    return [...g.hunked.changed, ...g.hunked.added, ...g.hunked.removed];
  });

  readonly classifiedHunks = computed<ReadonlyArray<RenderedHunk>>(() =>
    this.allHunks().map((h) => this.renderHunk(h)),
  );

  readonly changedRendered = computed<ReadonlyArray<RenderedHunk>>(() =>
    this.classifiedHunks().filter((rh) => rh.cls === 'changed'),
  );
  readonly addedRendered = computed<ReadonlyArray<RenderedHunk>>(() =>
    this.classifiedHunks().filter((rh) => rh.cls === 'added'),
  );
  readonly removedRendered = computed<ReadonlyArray<RenderedHunk>>(() =>
    this.classifiedHunks().filter((rh) => rh.cls === 'removed'),
  );

  readonly totalsLine = computed<string | null>(() => {
    const r = this.result();
    if (r.kind === 'grouped') {
      const totals = r.hunked.totals;
      let added = 0;
      let removed = 0;
      for (const h of [
        ...r.hunked.changed,
        ...r.hunked.added,
        ...r.hunked.removed,
      ]) {
        added += h.added;
        removed += h.removed;
      }
      return summaryLine(totals, added, removed);
    }
    if (r.kind === 'tabular') {
      return summaryLine(r.totals, r.diff.added.length, r.diff.removed.length);
    }
    return null;
  });

  hunkStateClasses(cls: HunkClass): Record<string, boolean> {
    return {
      'border-l-accent': cls === 'changed' || cls === 'added',
      'border-l-secondary': cls === 'removed',
      'bg-accent-soft/10': cls === 'changed',
      'bg-added-bg': cls === 'added',
      'bg-removed-bg': cls === 'removed',
    };
  }

  tabularRows(
    t: TabularDiffResponse,
  ): ReadonlyArray<{ side: '-' | '+'; entry: TabularDiffEntry }> {
    const removed = t.diff.removed.map((entry) => ({ side: '-' as const, entry }));
    const added = t.diff.added.map((entry) => ({ side: '+' as const, entry }));
    return [...added, ...removed];
  }

  termText(term: TabularTerm | undefined): string {
    if (!term) return '';
    const prefixes = this.effectivePrefixes();
    const base = this.effectiveBase();
    if (term.termType === 'NamedNode') {
      return curieOrIri(term.value, Object.entries(prefixes), base);
    }
    if (term.termType === 'BlankNode') return `_:${term.value}`;
    if (term.termType === 'Literal') {
      const lex = `"${term.value}"`;
      if (term.language) return `${lex}@${term.language}`;
      const dt = term.datatype?.value;
      if (
        dt &&
        dt !== 'http://www.w3.org/2001/XMLSchema#string' &&
        dt !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'
      ) {
        return `${lex}^^${curieOrIri(dt, Object.entries(prefixes), base)}`;
      }
      return lex;
    }
    return term.value;
  }

  formatLineBody(line: HunkLine, rh: RenderedHunk): string {
    const prefixes = this.effectivePrefixes();
    const base = this.effectiveBase();
    if (line.listItems !== undefined) {
      const prefixEntries = Object.entries(prefixes);
      const predicate = curieOrIri(line.predicate, prefixEntries, base);
      const items = line.listItems.map((item) =>
        shortenObjectTerm(item, prefixEntries, base),
      );
      return `${predicate} ( ${items.join(' ')} )`;
    }
    const shortened = shortenNQuadLine(line.nquad, { prefixes, base });
    const prefix = `${rh.anchorDisplay} `;
    return shortened.startsWith(prefix)
      ? shortened.slice(prefix.length)
      : shortened;
  }

  private renderHunk(hunk: Hunk): RenderedHunk {
    const cls = classifyHunk(hunk);
    const prefixEntries = Object.entries(this.effectivePrefixes());
    const base = this.effectiveBase();
    const anchorDisplay =
      hunk.orphan === true
        ? hunk.anchor
        : curieOrIri(hunk.anchor, prefixEntries, base);
    const rdfTypeDisplay =
      hunk.rdfType !== undefined
        ? curieOrIri(hunk.rdfType, prefixEntries, base)
        : null;
    const countsLabel = `[-${hunk.removed} +${hunk.added}]`;
    const records = dedupeRecordsByFileLine(hunk);
    const leftRecords = records.filter((r) => r.side === 'left');
    const rightRecords = records.filter((r) => r.side === 'right');
    const chips = renderChips(hunk);
    return {
      hunk,
      cls,
      anchorDisplay,
      rdfTypeDisplay,
      countsLabel,
      lines: hunk.lines,
      chips,
      leftRecords,
      rightRecords,
    };
  }
}

function summaryLine(
  totals: { left: number; right: number },
  added: number,
  removed: number,
): string {
  return `left=${totals.left} right=${totals.right} +${added} -${removed}`;
}

function dedupeRecordsByFileLine(hunk: Hunk): DedupedRecord[] {
  const sided: ReadonlyArray<readonly [SourceRecord, 'left' | 'right']> = [
    ...hunk.sourceRecords.left.map((r) => [r, 'left'] as const),
    ...hunk.sourceRecords.right.map((r) => [r, 'right'] as const),
  ];
  const ranges: DedupedRecord[] = [];
  for (const [r, side] of sided) {
    if (r.line === undefined) continue;
    ranges.push({
      file: r.file,
      focalStart: r.line,
      focalEnd: r.endLine ?? r.line,
      anchorId: anchorIdFor(r.file, r.line),
      side,
    });
  }
  // Drop B if some A on the same (file, side) strictly encloses or equals B
  // (and is kept itself by tie-break on identical ranges).
  return ranges.filter((b, i) =>
    !ranges.some(
      (a, j) =>
        i !== j &&
        a.file === b.file &&
        a.side === b.side &&
        a.focalStart <= b.focalStart &&
        a.focalEnd >= b.focalEnd &&
        !(
          a.focalStart === b.focalStart &&
          a.focalEnd === b.focalEnd &&
          j > i
        ),
    ),
  );
}

function renderChips(hunk: Hunk): ReadonlyArray<RenderedChip> {
  const out: RenderedChip[] = [];
  for (const r of hunk.sourceRecords.left) out.push(chipFor(r, 'left'));
  for (const r of hunk.sourceRecords.right) out.push(chipFor(r, 'right'));
  return out;
}

function chipFor(record: SourceRecord, side: 'left' | 'right'): RenderedChip {
  const base = baseName(record.file);
  const anchorId = record.line === undefined ? base : `${base}-L${record.line}`;
  const text = record.line === undefined ? base : `${base}:${record.line}`;
  return { side, text, anchorId };
}

function anchorIdFor(file: string, line: number): string {
  return `${baseName(file)}-L${line}`;
}

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/**
 * Shorten a serialized object term (as produced by `serializeObject` in
 * group-rdf-diff-by-entity): `<iri>` → CURIE, literals get their datatype
 * IRI shortened, bnodes pass through.
 */
function shortenObjectTerm(
  term: string,
  entries: ReadonlyArray<[string, string]>,
  base: string | undefined,
): string {
  if (term.startsWith('<') && term.endsWith('>')) {
    return curieOrIri(term.slice(1, -1), entries, base);
  }
  const dtMatch = /\^\^<([^>]+)>$/.exec(term);
  if (dtMatch) {
    const dtIri = dtMatch[1];
    const lex = term.slice(0, dtMatch.index);
    return `${lex}^^${curieOrIri(dtIri, entries, base)}`;
  }
  return term;
}

function curieOrIri(
  iri: string,
  entries: ReadonlyArray<[string, string]>,
  base: string | undefined,
): string {
  const match = bestPrefixEntryFor(iri, entries);
  if (match !== undefined) {
    const [name, ns] = match;
    return `${name}:${iri.slice(ns.length)}`;
  }
  if (base !== undefined && iri.startsWith(base)) {
    return `<${iri.slice(base.length)}>`;
  }
  return `<${iri}>`;
}
