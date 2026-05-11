import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

export interface DescribeRequest {
  iri: string;
  sources?: string[];
}

export interface DescribePerSourceEntry {
  count: number;
  truncated: boolean;
}

export interface DescribeResponse {
  iri: string;
  quads: string;
  total: number;
  perSource: Record<string, DescribePerSourceEntry>;
}

@Injectable({ providedIn: 'root' })
export class DescribeService {
  private readonly http = inject(HttpClient);

  run(req: DescribeRequest): Observable<DescribeResponse> {
    const body: DescribeRequest = { iri: req.iri };
    if (req.sources !== undefined) body.sources = [...req.sources];
    return this.http.post<DescribeResponse>('/api/describe', body);
  }
}
