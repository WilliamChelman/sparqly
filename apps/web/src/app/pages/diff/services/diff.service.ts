import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { DiffRequest, DiffResponse } from '../models/diff-response';

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
    return this.http.post<DiffResponse>('/api/diff', body);
  }
}
