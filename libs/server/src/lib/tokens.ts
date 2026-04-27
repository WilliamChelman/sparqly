import type { Store } from 'n3';

export const SPARQL_STORE_REF = Symbol('SPARQL_STORE_REF');
export const SPARQL_CONFIG = Symbol('SPARQL_CONFIG');

export interface StoreRef {
  current: Store;
}

export interface SparqlServerConfig {
  mutable: boolean;
}
