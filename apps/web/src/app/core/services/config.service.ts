import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, shareReplay, type Observable } from 'rxjs';

export type SourceKind = 'glob' | 'endpoint' | 'empty' | 'view' | 'file';

// Mirrors `SourceRow.mode` (ADR-0044); diff page gates Run on the raw
// pass-through modes per ADR-0047.
export type SourceListingMode = 'in-memory' | 'disk-backed' | 'endpoint';

export interface SourceListingEntry {
  id: string;
  kind: SourceKind;
  mode: SourceListingMode;
  label: string;
  default?: boolean;
  parentId?: string;
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

export interface SavedQueriesCapability {
  writable: boolean;
}

export interface SourcesAdminCapability {
  allowAdminActions: boolean;
}

export interface ConfigPayload {
  sources: SourceListingEntry[];
  context: DisplayContext;
  describe: DescribeConfig;
  savedQueries?: SavedQueriesCapability;
  sourcesAdmin?: SourcesAdminCapability;
}

export interface SourceListing {
  sources: SourceListingEntry[];
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly http = inject(HttpClient);
  private readonly _config = this.http
    .get<ConfigPayload>('/api/config')
    .pipe(shareReplay(1));

  config(): Observable<ConfigPayload> {
    return this._config;
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

  savedQueries(): Observable<SavedQueriesCapability> {
    return this.config().pipe(
      map((c) => ({ writable: c.savedQueries?.writable ?? true })),
    );
  }

  sourcesAdmin(): Observable<SourcesAdminCapability> {
    return this.config().pipe(
      map((c) => ({
        allowAdminActions: c.sourcesAdmin?.allowAdminActions ?? true,
      })),
    );
  }
}
