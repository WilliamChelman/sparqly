import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';

export type SourceKind = 'glob' | 'endpoint' | 'empty' | 'view' | 'file';

export interface SourceListingEntry {
  id: string;
  kind: SourceKind;
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

/**
 * **Source admin actions capability** (ADR-0045, #356). Mirrors the
 * sibling `sourcesAdmin` block on `GET /api/config` — sibling rather than
 * nested under `sources` so the existing listing array shape stays
 * untouched. Absence on the wire reads as the permissive default
 * (`allowAdminActions: true`), same convention as `savedQueries.writable`,
 * so the webapp's action menu stays reachable against an older `serve`
 * that doesn't yet expose the flag.
 */
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
