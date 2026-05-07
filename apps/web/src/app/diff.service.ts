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
}

export interface GraphDiffResponse {
  kind: 'graph';
  diff: {
    added: string[];
    removed: string[];
    totals: { left: number; right: number };
  };
  sourceRecords: {
    left: Record<string, SourceRecord[]>;
    right: Record<string, SourceRecord[]>;
  };
  totals: { left: number; right: number };
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
  | GraphDiffResponse
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
