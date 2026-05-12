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

export interface DiffErrorResponse {
  kind: 'error';
  errors: { left?: string; right?: string; top?: string };
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
