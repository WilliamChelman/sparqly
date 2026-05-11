import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';

export type SourceKind = 'glob' | 'endpoint' | 'empty' | 'view';

export interface SourceListingEntry {
  id: string;
  kind: SourceKind;
  label: string;
  default?: boolean;
}

export interface DisplayContext {
  prefixes: Record<string, string>;
  base?: string;
}

export interface DescribeConfig {
  perSourceSoftLimit: number;
  perSourceHardLimit: number;
  fromSourcePredicate: string;
}

export interface ConfigPayload {
  sources: SourceListingEntry[];
  context: DisplayContext;
  describe: DescribeConfig;
}

export interface SourceListing {
  sources: SourceListingEntry[];
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly http = inject(HttpClient);

  config(): Observable<ConfigPayload> {
    return this.http.get<ConfigPayload>('/api/config');
  }

  list(): Observable<SourceListing> {
    return this.config().pipe(map((c) => ({ sources: c.sources })));
  }

  context(): Observable<DisplayContext> {
    return this.config().pipe(map((c) => c.context));
  }

  describe(): Observable<DescribeConfig> {
    return this.config().pipe(map((c) => c.describe));
  }
}
