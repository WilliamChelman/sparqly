import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { bestPrefixEntryFor, DEFAULT_PREFIXES, shortenNQuadLine } from 'common';
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
} from './diff.service';
import { SourceSnippet } from './source-snippet';

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
  imports: [SourceSnippet, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (totalsLine(); as line) {
      <p
        data-testid="diff-totals"
        class="font-mono text-xs text-slate-600"
      >
        # {{ line }}
      </p>
    }
    @if (tabularView(); as t) {
      <table
        data-testid="tabular-diff"
        class="w-full border-collapse text-xs"
      >
        <thead>
          <tr class="border-b border-slate-300 text-left">
            <th class="px-2 py-1 font-semibold">side</th>
            <th class="px-2 py-1 font-semibold">count</th>
            @for (v of t.variables; track v) {
              <th class="px-2 py-1 font-semibold">{{ v }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (e of tabularRows(t); track $index) {
            <tr class="border-b border-slate-100">
              <td
                data-col="side"
                class="px-2 py-1 font-mono"
                [class.bg-red-50]="e.side === '-'"
                [class.bg-green-50]="e.side === '+'"
              >{{ e.side }}</td>
              <td data-col="count" class="px-2 py-1 font-mono">{{ e.entry.count }}</td>
              @for (v of t.variables; track v) {
                <td class="px-2 py-1 font-mono">{{ termText(e.entry.row[v]) }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
    }
    @if (groupedView(); as g) {
      <section data-testid="section-changed">
        <h2 class="text-sm font-semibold text-slate-700">Changed</h2>
        @if (changedHunks().length === 0) {
          <p data-testid="section-empty-changed" class="text-xs italic text-slate-500">(none)</p>
        }
        @for (rh of changedHunks(); track rh.hunk.anchor) {
          <ng-container *ngTemplateOutlet="hunkTpl; context: { $implicit: rh, section: 'changed' }" />
        }
      </section>
      <section data-testid="section-removed">
        <h2 class="text-sm font-semibold text-slate-700">Removed</h2>
        @if (removedHunks().length === 0) {
          <p data-testid="section-empty-removed" class="text-xs italic text-slate-500">(none)</p>
        }
        @for (rh of removedHunks(); track rh.hunk.anchor) {
          <ng-container *ngTemplateOutlet="hunkTpl; context: { $implicit: rh, section: 'removed' }" />
        }
      </section>
      <section data-testid="section-added">
        <h2 class="text-sm font-semibold text-slate-700">Added</h2>
        @if (addedHunks().length === 0) {
          <p data-testid="section-empty-added" class="text-xs italic text-slate-500">(none)</p>
        }
        @for (rh of addedHunks(); track rh.hunk.anchor) {
          <ng-container *ngTemplateOutlet="hunkTpl; context: { $implicit: rh, section: 'added' }" />
        }
      </section>

      <ng-template #hunkTpl let-rh let-section="section">
        <article
          data-testid="hunk"
          [attr.data-state]="rh.hunk.state"
          [attr.data-section]="section"
          [attr.data-orphan]="rh.hunk.orphan ? 'true' : null"
          class="my-2 border-l-2 border-slate-300 pl-2"
        >
          <header data-testid="hunk-header" class="flex flex-col gap-1">
            <div data-testid="hunk-title" class="break-all font-mono text-xs font-semibold">
              {{ rh.anchorDisplay }}@if (rh.rdfTypeDisplay) {  ({{ rh.rdfTypeDisplay }}) }@if (rh.hunk.orphan) {  (orphan) }@if (rh.stateLabel) {  ({{ rh.stateLabel }}) }  {{ rh.countsLabel }}
            </div>
            @if (rh.chips.length > 0) {
              <div data-testid="hunk-chips" class="flex flex-wrap gap-1 font-mono text-[11px]">
                @for (chip of rh.chips; track $index) {
                  <a
                    [attr.data-testid]="'hunk-chip-' + chip.side"
                    [attr.href]="'#' + chip.anchorId"
                    [class.bg-red-50]="chip.side === 'left'"
                    [class.bg-green-50]="chip.side === 'right'"
                    [class.border-red-200]="chip.side === 'left'"
                    [class.border-green-200]="chip.side === 'right'"
                    class="rounded border px-1"
                  >{{ chip.text }}</a>
                }
              </div>
            }
          </header>
          @if (rh.overflow) {
            <details data-testid="hunk-overflow" class="mt-1">
              <summary class="cursor-pointer text-xs text-slate-600">{{ rh.overflowLabel }}</summary>
              <ng-container *ngTemplateOutlet="bodyTpl; context: { $implicit: rh }" />
            </details>
          } @else {
            <ng-container *ngTemplateOutlet="bodyTpl; context: { $implicit: rh }" />
          }
          @if (rh.records.length > 0) {
            <div data-testid="hunk-snippets" class="mt-1 flex flex-col gap-3">
              @if (rh.leftRecords.length > 0) {
                <div
                  data-testid="hunk-snippets-left"
                  class="flex flex-col gap-1 rounded border border-red-200 bg-red-50/40 p-2"
                >
                  <div class="font-mono text-[11px] font-semibold uppercase tracking-wide text-red-700">left</div>
                  @for (rec of rh.leftRecords; track rec.anchorId) {
                    <div
                      [attr.id]="rec.anchorId"
                      [attr.data-testid]="'hunk-snippet'"
                      [attr.data-anchor-id]="rec.anchorId"
                      [attr.data-side]="'left'"
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
                  class="flex flex-col gap-1 rounded border border-green-200 bg-green-50/40 p-2"
                >
                  <div class="font-mono text-[11px] font-semibold uppercase tracking-wide text-green-700">right</div>
                  @for (rec of rh.rightRecords; track rec.anchorId) {
                    <div
                      [attr.id]="rec.anchorId"
                      [attr.data-testid]="'hunk-snippet'"
                      [attr.data-anchor-id]="rec.anchorId"
                      [attr.data-side]="'right'"
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
        <div data-testid="hunk-body" class="mt-1 overflow-x-auto font-mono text-xs">
          @for (cluster of rh.clusters; track $index) {
            @if (cluster.pair) {
              <div data-testid="hunk-pair" class="border-l border-slate-300 pl-1">
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
            class="block w-max min-w-full whitespace-pre rounded bg-red-50 px-1"
          >- {{ formatLineBody(line, rh) }}</span>
        } @else {
          <span
            data-testid="added-line"
            class="block w-max min-w-full whitespace-pre rounded bg-green-50 px-1"
          >+ {{ formatLineBody(line, rh) }}</span>
        }
      </ng-template>
    }
    @if (result().kind === 'error') {
      @let errs = errorView();
      @if (errs?.top) {
        <p
          data-testid="error-top"
          class="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700"
        >
          {{ errs?.top }}
        </p>
      }
      <div class="grid grid-cols-2 gap-4">
        @if (errs?.left) {
          <p
            data-testid="error-left"
            class="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700"
          >
            {{ errs?.left }}
          </p>
        }
        @if (errs?.right) {
          <p
            data-testid="error-right"
            class="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700"
          >
            {{ errs?.right }}
          </p>
        }
      </div>
    }
  `,
})
export class DiffResultRenderer {
  readonly result = input.required<DiffResponse>();
  readonly context = input<number>(3);

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
    if (term.termType === 'NamedNode') {
      return shortenNamedNode(term.value);
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
        return `${lex}^^${shortenNamedNode(dt)}`;
      }
      return lex;
    }
    return term.value;
  }

  formatLineBody(line: HunkLine, rh: RenderedHunk): string {
    const prefixes: Record<string, string> = { ...DEFAULT_PREFIXES };
    if (line.bnodePath !== undefined && line.bnodePath.length > 0) {
      return renderAbsorbedBnodeLine(line, prefixes);
    }
    const shortened = shortenNQuadLine(line.nquad, { prefixes });
    const prefix = `${rh.anchorDisplay} `;
    return shortened.startsWith(prefix)
      ? shortened.slice(prefix.length)
      : shortened;
  }

  private renderHunk(hunk: Hunk): RenderedHunk {
    const prefixEntries = Object.entries(DEFAULT_PREFIXES);
    const anchorDisplay = renderAnchor(hunk, prefixEntries);
    const rdfTypeDisplay =
      hunk.rdfType !== undefined ? curieOrIri(hunk.rdfType, prefixEntries) : null;
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
): string {
  if (hunk.orphan === true) return hunk.anchor;
  return curieOrIri(hunk.anchor, prefixEntries);
}

function curieOrIri(
  iri: string,
  entries: ReadonlyArray<[string, string]>,
): string {
  const match = bestPrefixEntryFor(iri, entries);
  if (match === undefined) return `<${iri}>`;
  const [name, ns] = match;
  return `${name}:${iri.slice(ns.length)}`;
}

function shortenNamedNode(iri: string): string {
  for (const [name, ns] of Object.entries(DEFAULT_PREFIXES)) {
    if (iri.startsWith(ns)) return `${name}:${iri.slice(ns.length)}`;
  }
  return `<${iri}>`;
}

function renderAbsorbedBnodeLine(
  line: HunkLine,
  prefixes: Record<string, string>,
): string {
  const prefixEntries = Object.entries(prefixes);
  const path = line.bnodePath as BnodePathStep[];
  const segments = path.map((step) => {
    if (step.identityIsBlank) return step.identityValue;
    const idPredicateCurie = curieOrIri(step.identityPredicate ?? '', prefixEntries);
    const idValueDisplay = renderIdentityValue(step.identityValue, prefixEntries);
    return `[${idPredicateCurie} ${idValueDisplay}]`;
  });
  const shortened = shortenNQuadLine(line.nquad, { prefixes });
  const firstSpace = shortened.indexOf(' ');
  const tail = firstSpace >= 0 ? shortened.slice(firstSpace + 1) : shortened;
  return `${segments.join(' / ')} / ${tail}`;
}

function renderIdentityValue(
  value: string,
  prefixEntries: ReadonlyArray<[string, string]>,
): string {
  if (value.startsWith('"') || value.startsWith('_:') || value.startsWith('<')) {
    return value;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    return curieOrIri(value, prefixEntries);
  }
  return value;
}
