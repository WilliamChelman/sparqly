export interface QueryEngineOptions {
  immutable: boolean;
}

export class QueryEngine {
  constructor(private readonly options: QueryEngineOptions) {}

  async execute(_query: string): Promise<never> {
    throw new Error('QueryEngine.execute not yet implemented');
  }
}
