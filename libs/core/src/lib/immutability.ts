import { Parser as SparqlParser } from 'sparqljs';

export type QueryType = 'SELECT' | 'ASK' | 'CONSTRUCT' | 'DESCRIBE' | 'UPDATE';

export interface ImmutabilityOptions {
  mutable?: boolean;
}

export function assertImmutable(
  queryType: QueryType,
  options: ImmutabilityOptions = {},
): void {
  if (queryType !== 'UPDATE') return;
  if (!options.mutable) {
    throw new Error(
      'Mutating queries are disabled. Pass --mutable or --immutable=false to allow.',
    );
  }
  throw new Error(
    'Mutating execution is not yet implemented. The immutability guard was bypassed but UPDATE/INSERT/DELETE/LOAD execution will land in a future release.',
  );
}

export function detectQueryType(query: string): QueryType {
  const parsed = new SparqlParser().parse(query);
  if (parsed.type === 'update') return 'UPDATE';
  if (parsed.type === 'query') {
    switch (parsed.queryType) {
      case 'SELECT':
        return 'SELECT';
      case 'ASK':
        return 'ASK';
      case 'CONSTRUCT':
        return 'CONSTRUCT';
      case 'DESCRIBE':
        return 'DESCRIBE';
    }
  }
  throw new Error(`Unsupported SPARQL query shape`);
}
