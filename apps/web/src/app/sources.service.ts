import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

export type SourceKind = 'glob' | 'endpoint' | 'empty' | 'view';

export interface SourceListingEntry {
  id: string;
  kind: SourceKind;
  label: string;
  default?: boolean;
}

export interface SourceListing {
  sources: SourceListingEntry[];
}

@Injectable({ providedIn: 'root' })
export class SourcesService {
  private readonly http = inject(HttpClient);

  list(): Observable<SourceListing> {
    return this.http.get<SourceListing>('/api/sources');
  }
}
