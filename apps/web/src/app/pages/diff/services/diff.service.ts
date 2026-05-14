import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

export interface DiffRequest {
  left: string;
  right: string;
  leftQuery?: string;
  rightQuery?: string;
  skipAutoSourceAnnotation?: boolean;
}

/**
 * Wire mirror of `libs/core/src/lib/diff/errors.ts`. Each variant carries
 * structured fields so the renderer can highlight the offending SELECT chip
 * for `tabular-blank-node`; `legacy-message` is the transitional bucket for
 * un-converted thrown messages (ADR-0024).
 *
 * `target` follows the wrap-don't-duplicate rule: registry-selection failures
 * live in their own `TargetError` union and are rendered here by dispatching
 * on `target.kind` rather than duplicating variants per consumer.
 */
export type DiffError =
  | TabularBlankNodeError
  | TargetWrappedError
  | LegacyMessageError;

export interface TabularBlankNodeError {
  kind: 'tabular-blank-node';
  column: string;
}

export interface TargetWrappedError {
  kind: 'target';
  side: 'left' | 'right';
  target: TargetError;
}

/**
 * Wire mirror of `libs/core/src/lib/target/errors.ts`. The webapp inline-error
 * renderer dispatches on `kind` to render structured registry-selection
 * failures (e.g. `unknown @id` with the list of available ids).
 */
export type TargetError =
  | RefAsTargetError
  | EmptyRegistryError
  | NoDefaultMultiError
  | UnknownRefError;

export interface RefAsTargetError {
  kind: 'ref-as-target';
}

export interface EmptyRegistryError {
  kind: 'empty-registry';
}

export interface NoDefaultMultiError {
  kind: 'no-default-multi';
  availableIds: ReadonlyArray<string>;
}

export interface UnknownRefError {
  kind: 'unknown-ref';
  ref: string;
  availableIds: ReadonlyArray<string>;
}

export interface LegacyMessageError {
  kind: 'legacy-message';
  message: string;
}

export interface DiffErrorResponse {
  kind: 'error';
  errors: { left?: DiffError; right?: DiffError; top?: DiffError };
}

export function formatDiffError(error: DiffError): string {
  switch (error.kind) {
    case 'tabular-blank-node':
      return `tabular diff cannot key a row with a blank-node-valued column ?${error.column}: blank nodes have no cross-side identity. Project a stable IRI or literal in your SELECT (e.g. via a deterministic IRI mint or by selecting an identifying property) instead.`;
    case 'target':
      return formatTargetError(error.target);
    case 'legacy-message':
      return error.message;
  }
}

export function formatTargetError(error: TargetError): string {
  switch (error.kind) {
    case 'ref-as-target':
      return "`kind: 'reference'` entries are aliases, not data, and cannot be used as a target source";
    case 'empty-registry':
      return 'registry is empty; no target source to select';
    case 'no-default-multi':
      return `registry has multiple entries and no \`default: true\`; pass an explicit target. Available: ${formatAvailable(error.availableIds)}`;
    case 'unknown-ref':
      return `no source matches ${error.ref}. Available: ${formatAvailable(error.availableIds)}`;
  }
}

function formatAvailable(ids: ReadonlyArray<string>): string {
  if (ids.length === 0) return '<none>';
  return ids.map((id) => `@${id}`).join(', ');
}

export interface SourceRecord {
  file: string;
  line?: number;
  endLine?: number;
}

export interface BnodePathStep {
  parentPredicate: string;
  identityPredicate?: string;
  identityValue: string;
  identityIsBlank: boolean;
}

export interface HunkLine {
  side: '-' | '+';
  subjectPath: string;
  predicate: string;
  object: string;
  nquad: string;
  bnodePath?: BnodePathStep[];
  listItems?: ReadonlyArray<string>;
}

export interface Hunk {
  anchor: string;
  rdfType?: string;
  state: 'changed' | 'removed' | 'added';
  orphan?: boolean;
  removed: number;
  added: number;
  lines: HunkLine[];
  sourceRecords: { left: SourceRecord[]; right: SourceRecord[] };
  /**
   * The anchor's definition site on a side where it exists but contributed no
   * changed-line source records — one record per file the anchor's triples are
   * annotated from, focused on the earliest annotated line. Present only on
   * `changed` hunks where a side qualifies; the renderer shows these under a
   * muted `defined here` heading, distinct from a real change.
   */
  anchorSource?: { left: SourceRecord[]; right: SourceRecord[] };
}

export interface HunkedRdfDiff {
  hunks: Hunk[];
  totals: { left: number; right: number };
}

export interface GroupedDiffResponse {
  kind: 'grouped';
  hunked: HunkedRdfDiff;
}

export interface TabularTerm {
  termType: 'NamedNode' | 'BlankNode' | 'Literal' | 'DefaultGraph' | 'Variable';
  value: string;
  language?: string;
  datatype?: { value: string };
}

export type TabularRow = Record<string, TabularTerm | undefined>;

export interface TabularDiffEntry {
  row: TabularRow;
  count: number;
}

export interface TabularDiffResponse {
  kind: 'tabular';
  diff: {
    added: TabularDiffEntry[];
    removed: TabularDiffEntry[];
    totals: { left: number; right: number };
  };
  totals: { left: number; right: number };
  variables: string[];
}

export type DiffResponse =
  | GroupedDiffResponse
  | TabularDiffResponse
  | DiffErrorResponse;

@Injectable({ providedIn: 'root' })
export class DiffService {
  private readonly http = inject(HttpClient);

  run(req: DiffRequest): Observable<DiffResponse> {
    const body: DiffRequest = { left: req.left, right: req.right };
    if (req.leftQuery !== undefined && req.leftQuery.length > 0) {
      body.leftQuery = req.leftQuery;
    }
    if (req.rightQuery !== undefined && req.rightQuery.length > 0) {
      body.rightQuery = req.rightQuery;
    }
    if (req.skipAutoSourceAnnotation === true) {
      body.skipAutoSourceAnnotation = true;
    }
    return this.http.post<DiffResponse>('/api/diff', body);
  }
}
