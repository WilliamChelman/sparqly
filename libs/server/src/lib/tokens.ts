export const SPARQL_STORE = Symbol('SPARQL_STORE');
export const SPARQL_CONFIG = Symbol('SPARQL_CONFIG');

export interface SparqlServerConfig {
  mutable: boolean;
}
