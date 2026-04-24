export type SparqlFormat =
  | 'application/sparql-results+json'
  | 'text/turtle';

export interface SparqlRequest {
  query: string;
  accept?: SparqlFormat;
}

export interface SparqlErrorResponse {
  error: string;
  message: string;
}
