import type { QueryEngine } from 'core';
import type { Store } from 'n3';

export const SPARQL_ENGINE = Symbol('SPARQL_ENGINE');
export const SPARQL_CONFIG = Symbol('SPARQL_CONFIG');

export interface StoreRef {
  current: Store;
}

export interface SparqlServerConfig {
  mutable: boolean;
}

export type EngineProvider = QueryEngine;
