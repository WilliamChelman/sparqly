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
  BnodePathStep,
  DiffResponse,
  GroupedDiffResponse,
  Hunk,
  HunkLine,
  SourceRecord,
  TabularDiffEntry,
  TabularDiffResponse,
  TabularTerm,
} from '../services/diff.service';
import { SourceSnippetComponent } from './source-snippet.component';

interface DedupedRecord {
  file: string;
  line: number;
  anchorId: string;
  side: 'left' | 'right';
}

interface LineCluster {
  pair: boolean;
  lines: HunkLine[];
}

interface RenderedHunk {
  hunk: Hunk;
  anchorDisplay: string;
  rdfTypeDisplay: string | null;
  countsLabel: string;
  stateLabel: string | null;
  clusters: LineCluster[];
  records: DedupedRecord[];
  leftRecords: DedupedRecord[];
  rightRecords: DedupedRecord[];
  overflow: boolean;
  overflowLabel: string;
  chips: ReadonlyArray<RenderedChip>;
}

interface RenderedChip {
  side: 'left' | 'right';
  text: string;
  anchorId: string;
}

const OVERFLOW_LINE_THRESHOLD = 20;

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

      .my-hunk-overflow > summary::-webkit-details-marker {
        display: none;
      }
      .my-hunk-overflow > summary::before {
        content: '▸ ';
        color: var(--ink-faint);
      }
      .my-hunk-overflow[open] > summary::before {
        content: '▾ ';
      }
    `,
  ],
  template: `
    @if (totalsLine(); as line) {
      <p
        data-testid="diff-totals"
        class="flex items-center gap-3.5 rounded-lg border border-border-muted bg-surface-sunken px-[18px] py-3 font-mono text-xs text-foreground-muted"
      >
        # {{ line }}
      </p>
    }
    @if (tabularView(); as t) {
      <table
        data-testid="tabular-diff"
        class="w-full border-collapse bg-surface font-mono text-xs [&_td]:border-b [&_td]:border-border-muted [&_td]:px-3 [&_td]:py-[7px] [&_td]:text-left [&_th]:border-b [&_th]:border-border-muted [&_th]:px-3 [&_th]:py-[7px] [&_th]:text-left [&_thead_th]:bg-surface-sunken [&_thead_th]:font-sans [&_thead_th]:text-[10px] [&_thead_th]:uppercase [&_thead_th]:tracking-[0.14em] [&_thead_th]:text-foreground-faint"
      >
        <thead>
          <tr>
            <th data-col="side" class="w-[26px] text-center">side</th>
            <th data-col="count">count</th>
            @for (v of t.variables; track v) {
              <th>{{ v }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (e of tabularRows(t); track $index) {
            <tr
              [class.bg-added-bg]="e.side === '+'"
              [class.bg-removed-bg]="e.side === '-'"
            >
              <td
                data-col="side"
                class="w-[26px] text-center font-semibold"
                [class.text-accent-strong]="e.side === '+'"
                [class.dark:text-accent]="e.side === '+'"
                [class.text-secondary-strong]="e.side === '-'"
                [class.dark:text-secondary]="e.side === '-'"
              >{{ e.side }}</td>
              <td data-col="count">{{ e.entry.count }}</td>
              @for (v of t.variables; track v) {
                <td>{{ termText(e.entry.row[v]) }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
    }
    @if (groupedView(); as g) {
      <ng-container
        *ngTemplateOutlet="
          sectionTpl;
          context: {
            testid: 'section-changed',
            emptyTestid: 'section-empty-changed',
            title: 'Changed',
            hunks: changedHunks(),
            countLabel: changedCountLabel(),
          }
        "
      />
      <ng-container
        *ngTemplateOutlet="
          sectionTpl;
          context: {
            testid: 'section-removed',
            emptyTestid: 'section-empty-removed',
            title: 'Removed',
            hunks: removedHunks(),
            countLabel: removedCountLabel(),
          }
        "
      />
      <ng-container
        *ngTemplateOutlet="
          sectionTpl;
          context: {
            testid: 'section-added',
            emptyTestid: 'section-empty-added',
            title: 'Added',
            hunks: addedHunks(),
            countLabel: addedCountLabel(),
          }
        "
      />

      <ng-template
        #sectionTpl
        let-testid="testid"
        let-emptyTestid="emptyTestid"
        let-title="title"
        let-hunks="hunks"
        let-countLabel="countLabel"
      >
        <section [attr.data-testid]="testid" class="mt-2">
          <div
            class="mb-2 flex items-baseline justify-between border-b border-dashed border-border-muted pb-2 pt-4"
          >
            <h2
              class="m-0 font-serif text-lg font-medium italic text-foreground [font-variation-settings:'opsz'_36]"
            >{{ title }}</h2>
            <span
              class="font-mono text-[11px] uppercase tracking-[0.12em] text-foreground-faint"
              >{{ countLabel }}</span
            >
          </div>
          @if (hunks.length === 0) {
            <p
              [attr.data-testid]="emptyTestid"
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
          class="relative my-3 rounded-r-md border-l-2 py-3.5 pl-[22px] pr-4"
          [ngClass]="hunkStateClasses(rh.hunk.state)"
        >
          <header data-testid="hunk-header" class="mb-2 flex flex-col gap-1.5">
            <div
              data-testid="hunk-title"
              class="flex flex-wrap items-center gap-2.5 break-all font-mono text-xs font-semibold text-foreground"
            >
              {{ rh.anchorDisplay }}@if (rh.rdfTypeDisplay) {  ({{ rh.rdfTypeDisplay }}) }@if (rh.hunk.orphan) {  (orphan) }@if (rh.stateLabel) {  ({{ rh.stateLabel }}) }  {{ rh.countsLabel }}
            </div>
            @if (rh.chips.length > 0) {
              <div data-testid="hunk-chips" class="flex flex-wrap gap-1.5">
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
          </header>
          @if (rh.overflow) {
            <details data-testid="hunk-overflow" class="my-hunk-overflow mt-1">
              <summary class="cursor-pointer list-none font-mono text-[11px] text-foreground-muted">{{ rh.overflowLabel }}</summary>
              <ng-container *ngTemplateOutlet="bodyTpl; context: { $implicit: rh }" />
            </details>
          } @else {
            <ng-container *ngTemplateOutlet="bodyTpl; context: { $implicit: rh }" />
          }
          @if (rh.records.length > 0) {
            <div
              data-testid="hunk-snippets"
              class="mt-2.5 flex flex-col gap-3"
            >
              @if (rh.leftRecords.length > 0) {
                <div
                  data-testid="hunk-snippets-left"
                  class="flex flex-col gap-1.5 rounded-md border border-removed-line bg-removed-bg p-2.5"
                >
                  <div
                    class="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-removed"
                  >left</div>
                  @for (rec of rh.leftRecords; track rec.anchorId) {
                    <div
                      [attr.id]="rec.anchorId"
                      data-testid="hunk-snippet"
                      [attr.data-anchor-id]="rec.anchorId"
                    >
                      <app-source-snippet
                        [file]="rec.file"
                        [line]="rec.line"
                        [context]="context()"
                      />
                    </div>
                  }
                </div>
              }
              @if (rh.rightRecords.length > 0) {
                <div
                  data-testid="hunk-snippets-right"
                  class="flex flex-col gap-1.5 rounded-md border border-added-line bg-added-bg p-2.5"
                >
                  <div
                    class="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-added"
                  >right</div>
                  @for (rec of rh.rightRecords; track rec.anchorId) {
                    <div
                      [attr.id]="rec.anchorId"
                      data-testid="hunk-snippet"
                      [attr.data-anchor-id]="rec.anchorId"
                    >
                      <app-source-snippet
                        [file]="rec.file"
                        [line]="rec.line"
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

      <ng-template #bodyTpl let-rh>
        <div
          data-testid="hunk-body"
          class="overflow-x-auto font-mono text-xs leading-[1.45]"
        >
          @for (cluster of rh.clusters; track $index) {
            @if (cluster.pair) {
              <div
                data-testid="hunk-pair"
                class="my-0.5 border-l border-border-muted pl-1"
              >
                @for (line of cluster.lines; track $index) {
                  <ng-container
                    *ngTemplateOutlet="lineTpl; context: { $implicit: line, rh: rh }"
                  />
                }
              </div>
            } @else {
              <ng-container
                *ngTemplateOutlet="lineTpl; context: { $implicit: cluster.lines[0], rh: rh }"
              />
            }
          }
        </div>
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
        >
          {{ errs?.top }}
        </p>
      }
      <div class="grid grid-cols-2 gap-4">
        @if (errs?.left) {
          <p
            data-testid="error-left"
            class="flex items-start gap-2.5 rounded-lg border border-error-line bg-error-bg px-3.5 py-3 font-mono text-xs text-error"
          >
            {{ errs?.left }}
          </p>
        }
        @if (errs?.right) {
          <p
            data-testid="error-right"
            class="flex items-start gap-2.5 rounded-lg border border-error-line bg-error-bg px-3.5 py-3 font-mono text-xs text-error"
          >
            {{ errs?.right }}
          </p>
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

  readonly changedHunks = computed<RenderedHunk[]>(() => {
    const g = this.groupedView();
    return g === null ? [] : g.hunked.changed.map((h) => this.renderHunk(h));
  });

  readonly removedHunks = computed<RenderedHunk[]>(() => {
    const g = this.groupedView();
    return g === null ? [] : g.hunked.removed.map((h) => this.renderHunk(h));
  });

  readonly addedHunks = computed<RenderedHunk[]>(() => {
    const g = this.groupedView();
    return g === null ? [] : g.hunked.added.map((h) => this.renderHunk(h));
  });

  readonly changedCountLabel = computed<string>(() =>
    countLabel(this.changedHunks().length),
  );
  readonly removedCountLabel = computed<string>(() =>
    countLabel(this.removedHunks().length),
  );
  readonly addedCountLabel = computed<string>(() =>
    countLabel(this.addedHunks().length),
  );

  readonly totalsLine = computed<string | null>(() => {
    const r = this.result();
    if (r.kind === 'grouped') {
      const totals = r.hunked.totals;
      const added = sumLines(r, '+');
      const removed = sumLines(r, '-');
      return summaryLine(totals, added, removed);
    }
    if (r.kind === 'tabular') {
      return summaryLine(
        r.totals,
        r.diff.added.length,
        r.diff.removed.length,
      );
    }
    return null;
  });

  hunkStateClasses(state: Hunk['state']): Record<string, boolean> {
    return {
      'border-l-accent': state === 'changed' || state === 'added',
      'border-l-secondary': state === 'removed',
      'bg-accent-soft/10': state === 'changed',
      'bg-added-bg': state === 'added',
      'bg-removed-bg': state === 'removed',
    };
  }

  tabularRows(
    t: TabularDiffResponse,
  ): ReadonlyArray<{ side: '-' | '+'; entry: TabularDiffEntry }> {
    const removed = t.diff.removed.map((entry) => ({
      side: '-' as const,
      entry,
    }));
    const added = t.diff.added.map((entry) => ({ side: '+' as const, entry }));
    return [...removed, ...added];
  }

  termText(term: TabularTerm | undefined): string {
    if (!term) return '';
    const prefixes = this.effectivePrefixes();
    const base = this.effectiveBase();
    if (term.termType === 'NamedNode') {
      return shortenNamedNode(term.value, prefixes, base);
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
        return `${lex}^^${shortenNamedNode(dt, prefixes, base)}`;
      }
      return lex;
    }
    return term.value;
  }

  formatLineBody(line: HunkLine, rh: RenderedHunk): string {
    const prefixes = this.effectivePrefixes();
    const base = this.effectiveBase();
    if (line.bnodePath !== undefined && line.bnodePath.length > 0) {
      return renderAbsorbedBnodeLine(line, prefixes, base);
    }
    const shortened = shortenNQuadLine(line.nquad, { prefixes, base });
    const prefix = `${rh.anchorDisplay} `;
    return shortened.startsWith(prefix)
      ? shortened.slice(prefix.length)
      : shortened;
  }

  private renderHunk(hunk: Hunk): RenderedHunk {
    const prefixEntries = Object.entries(this.effectivePrefixes());
    const base = this.effectiveBase();
    const anchorDisplay = renderAnchor(hunk, prefixEntries, base);
    const rdfTypeDisplay =
      hunk.rdfType !== undefined ? curieOrIri(hunk.rdfType, prefixEntries, base) : null;
    const stateLabel = hunk.state === 'changed' ? null : hunk.state;
    const countsLabel = `[-${hunk.removed} +${hunk.added}]`;
    const clusters = clusterLinesIntoPairs(hunk.lines);
    const records = dedupeRecordsByFileLine(hunk);
    const leftRecords = records.filter((r) => r.side === 'left');
    const rightRecords = records.filter((r) => r.side === 'right');
    const overflow = hunk.lines.length > OVERFLOW_LINE_THRESHOLD;
    const overflowLabel = `Show ${hunk.lines.length} more`;
    const chips = renderChips(hunk);
    return {
      hunk,
      anchorDisplay,
      rdfTypeDisplay,
      countsLabel,
      stateLabel,
      clusters,
      records,
      leftRecords,
      rightRecords,
      overflow,
      overflowLabel,
      chips,
    };
  }
}

function countLabel(n: number): string {
  if (n === 0) return '(none)';
  return `${n} hunk${n === 1 ? '' : 's'}`;
}

function summaryLine(
  totals: { left: number; right: number },
  added: number,
  removed: number,
): string {
  return `left=${totals.left} right=${totals.right} +${added} -${removed}`;
}

function sumLines(r: GroupedDiffResponse, side: '-' | '+'): number {
  let n = 0;
  for (const h of [...r.hunked.changed, ...r.hunked.removed, ...r.hunked.added]) {
    n += side === '-' ? h.removed : h.added;
  }
  return n;
}

function dedupeRecordsByFileLine(hunk: Hunk): DedupedRecord[] {
  const seen = new Set<string>();
  const out: DedupedRecord[] = [];
  const sided: ReadonlyArray<readonly [SourceRecord, 'left' | 'right']> = [
    ...hunk.sourceRecords.left.map((r) => [r, 'left'] as const),
    ...hunk.sourceRecords.right.map((r) => [r, 'right'] as const),
  ];
  for (const [r, side] of sided) {
    if (r.line === undefined) continue;
    const key = `${r.file}:${r.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      file: r.file,
      line: r.line,
      anchorId: anchorIdFor(r.file, r.line),
      side,
    });
  }
  return out;
}

function anchorIdFor(file: string, line: number): string {
  return `${baseName(file)}-L${line}`;
}

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

function renderChips(hunk: Hunk): ReadonlyArray<RenderedChip> {
  const out: RenderedChip[] = [];
  for (const r of hunk.sourceRecords.left) {
    out.push(chipFor(r, 'left'));
  }
  for (const r of hunk.sourceRecords.right) {
    out.push(chipFor(r, 'right'));
  }
  return out;
}

function chipFor(record: SourceRecord, side: 'left' | 'right'): RenderedChip {
  const base = baseName(record.file);
  const anchorId = record.line === undefined ? base : `${base}-L${record.line}`;
  const text = record.line === undefined ? base : `${base}:${record.line}`;
  return { side, text, anchorId };
}

function clusterLinesIntoPairs(lines: ReadonlyArray<HunkLine>): LineCluster[] {
  const result: LineCluster[] = [];
  let i = 0;
  while (i < lines.length) {
    const a = lines[i];
    const b = lines[i + 1];
    if (
      b !== undefined &&
      a.side === '-' &&
      b.side === '+' &&
      a.subjectPath === b.subjectPath &&
      a.predicate === b.predicate
    ) {
      result.push({ pair: true, lines: [a, b] });
      i += 2;
    } else {
      result.push({ pair: false, lines: [a] });
      i += 1;
    }
  }
  return result;
}

function renderAnchor(
  hunk: Hunk,
  prefixEntries: ReadonlyArray<[string, string]>,
  base: string | undefined,
): string {
  if (hunk.orphan === true) return hunk.anchor;
  return curieOrIri(hunk.anchor, prefixEntries, base);
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

function shortenNamedNode(
  iri: string,
  prefixes: Record<string, string>,
  base: string | undefined,
): string {
  return curieOrIri(iri, Object.entries(prefixes), base);
}

function renderAbsorbedBnodeLine(
  line: HunkLine,
  prefixes: Record<string, string>,
  base: string | undefined,
): string {
  const prefixEntries = Object.entries(prefixes);
  const path = line.bnodePath as BnodePathStep[];
  const segments = path.map((step) => {
    if (step.identityIsBlank) return step.identityValue;
    const idPredicateCurie = curieOrIri(step.identityPredicate ?? '', prefixEntries, base);
    const idValueDisplay = renderIdentityValue(step.identityValue, prefixEntries, base);
    return `[${idPredicateCurie} ${idValueDisplay}]`;
  });
  const shortened = shortenNQuadLine(line.nquad, { prefixes, base });
  const firstSpace = shortened.indexOf(' ');
  const tail = firstSpace >= 0 ? shortened.slice(firstSpace + 1) : shortened;
  return `${segments.join(' / ')} / ${tail}`;
}

function renderIdentityValue(
  value: string,
  prefixEntries: ReadonlyArray<[string, string]>,
  base: string | undefined,
): string {
  if (value.startsWith('"') || value.startsWith('_:') || value.startsWith('<')) {
    return value;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    return curieOrIri(value, prefixEntries, base);
  }
  return value;
}
