import type { Store } from 'n3';
import type { EngineMap } from './engine-map';

export const SPARQL_CONFIG = Symbol('SPARQL_CONFIG');
export const SPARQL_CONTEXT = Symbol('SPARQL_CONTEXT');
export const SPARQL_ENGINE_MAP = Symbol('SPARQL_ENGINE_MAP');
export const SPARQL_DEFAULT_ID = Symbol('SPARQL_DEFAULT_ID');
export const SPARQL_SERVED_REGISTRY = Symbol('SPARQL_SERVED_REGISTRY');
export const SPARQL_DIFF_SERVICE = Symbol('SPARQL_DIFF_SERVICE');
export const SPARQL_DESCRIBE_SERVICE = Symbol('SPARQL_DESCRIBE_SERVICE');
export const SPARQL_DESCRIBE_CONFIG = Symbol('SPARQL_DESCRIBE_CONFIG');
export const SPARQL_SNIPPET_ALLOW_LIST = Symbol('SPARQL_SNIPPET_ALLOW_LIST');
export const SPARQL_META_CHILDREN_CACHE = Symbol('SPARQL_META_CHILDREN_CACHE');

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

export type SourceKind = 'glob' | 'endpoint' | 'empty' | 'view' | 'file';

export interface SourceListingEntry {
  id: string;
  kind: SourceKind;
  label: string;
  default?: boolean;
  parentId?: string;
}

export type EngineMapProvider = EngineMap;
