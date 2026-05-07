import type { QueryEngine } from 'core';
import type { Store } from 'n3';
import type { EngineMap } from './engine-map';

export const SPARQL_ENGINE = Symbol('SPARQL_ENGINE');
export const SPARQL_CONFIG = Symbol('SPARQL_CONFIG');
export const SPARQL_ENGINE_MAP = Symbol('SPARQL_ENGINE_MAP');
export const SPARQL_REGISTRY_LISTING = Symbol('SPARQL_REGISTRY_LISTING');
export const SPARQL_DIFF_SERVICE = Symbol('SPARQL_DIFF_SERVICE');
export const SPARQL_SNIPPET_ALLOW_LIST = Symbol('SPARQL_SNIPPET_ALLOW_LIST');

export interface StoreRef {
  current: Store;
}

export interface SparqlServerConfig {
  mutable: boolean;
}

export type EngineProvider = QueryEngine;

export type SourceKind = 'glob' | 'endpoint' | 'empty' | 'view';

export interface SourceListingEntry {
  id: string;
  kind: SourceKind;
  label: string;
  default?: boolean;
}

export type EngineMapProvider = EngineMap;
