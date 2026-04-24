export type QueryType = 'SELECT' | 'ASK' | 'CONSTRUCT' | 'DESCRIBE' | 'UPDATE';

export function assertImmutable(queryType: QueryType): void {
  if (queryType === 'UPDATE') {
    throw new Error(
      'Mutating queries are disabled. Pass --mutable or --immutable=false to allow.',
    );
  }
}
