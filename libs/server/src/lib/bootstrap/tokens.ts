import type { Store } from 'n3';
import type { EngineMap } from './engine-map';

export const SPARQL_CONFIG = Symbol('SPARQL_CONFIG');
export const SPARQL_CONTEXT = Symbol('SPARQL_CONTEXT');
export const SPARQL_ENGINE_MAP = Symbol('SPARQL_ENGINE_MAP');
export const SPARQL_DEFAULT_ID = Symbol('SPARQL_DEFAULT_ID');
export const SPARQL_SERVED_REGISTRY = Symbol('SPARQL_SERVED_REGISTRY');
export const SPARQL_RESOLUTION_REGISTRY = Symbol('SPARQL_RESOLUTION_REGISTRY');
export const SPARQL_DIFF_SERVICE = Symbol('SPARQL_DIFF_SERVICE');
export const SPARQL_DESCRIBE_SERVICE = Symbol('SPARQL_DESCRIBE_SERVICE');
export const SPARQL_DESCRIBE_CONFIG = Symbol('SPARQL_DESCRIBE_CONFIG');
export const SPARQL_SNIPPET_ALLOW_LIST = Symbol('SPARQL_SNIPPET_ALLOW_LIST');
export const SPARQL_META_CHILDREN_CACHE = Symbol('SPARQL_META_CHILDREN_CACHE');
export const SPARQL_SAVED_QUERIES_CONFIG = Symbol('SPARQL_SAVED_QUERIES_CONFIG');
export const SPARQL_SAVED_QUERIES_SERVICE = Symbol('SPARQL_SAVED_QUERIES_SERVICE');
/**
 * Source state broker — the bridge between `EngineMap`'s
 * `SourceStateEmitter` and the `GET /api/sources/stream` SSE wire
 * (ADR-0044, #354). Owns the ring buffer backing the `Last-Event-ID`
 * replay path and the live multicast subject. Provided per server lifetime.
 */
export const SPARQL_SOURCE_STATE_BROKER = Symbol('SPARQL_SOURCE_STATE_BROKER');
/**
 * **Source admin actions capability** flag — defaulted from `serve --read-only`
 * (ADR-0045) but kept as a separately-named flag because the gated mutation
 * class is genuinely different from `savedQueries.writable` (server resources,
 * not project files). Provided per server lifetime. Read by:
 *
 * - {@link ConfigController} to emit `sourcesAdmin.allowAdminActions` on
 *   `GET /api/config`, so the webapp can hide every action affordance when
 *   the deployment is read-only.
 * - {@link SourcesController}'s mutating routes (load/reload/unload, plus
 *   later disk-backed (re)build / cancel / test-connection in subsequent
 *   slices of parent #352) to reject with `403 Forbidden`.
 */
export const SPARQL_SOURCES_ADMIN_CONFIG = Symbol('SPARQL_SOURCES_ADMIN_CONFIG');

export interface SparqlContext {
  prefixes: Record<string, string>;
  base?: string;
}

export interface StoreRef {
  current: Store;
}

export interface SparqlServerConfig {
  mutable: boolean;
}

/**
 * Server-side shape of the **Source admin actions capability** (ADR-0045).
 * Defaulted from the `serve --read-only` switch (defaulted *false* there,
 * meaning admin actions are allowed under default). Independently overridable
 * in project config so a deployment can run e.g. read-only saved queries with
 * admin actions on, or vice versa, without lifting the CLI switch.
 */
export interface SourcesAdminServerConfig {
  /**
   * When `false`, `SourcesController`'s mutating routes (Load now / Reload /
   * Unload — and, in later slices of #352, (Re)build index / Cancel / Test
   * connection) reject with `403 Forbidden`; `/api/config` advertises
   * `sourcesAdmin.allowAdminActions: false` so the webapp hides the
   * corresponding affordances. The snapshot endpoint and the SSE stream
   * remain readable either way (read-only monitoring keeps working).
   */
  allowAdminActions: boolean;
}

export interface SavedQueriesServerConfig {
  /** Absolute path to the saved-query sidecar YAML file. */
  path: string;
  /**
   * Whether `serve` accepts writes to the sidecar (PUT/DELETE). When `false`
   * the controller short-circuits writes with 405 and `/api/config` advertises
   * `savedQueries.writable: false` so the webapp can hide affordances.
   */
  writable: boolean;
}

export type SourceKind = 'glob' | 'endpoint' | 'empty' | 'view' | 'file';

export interface SourceListingEntry {
  id: string;
  kind: SourceKind;
  label: string;
  default?: boolean;
  parentId?: string;
}

export type EngineMapProvider = EngineMap;
