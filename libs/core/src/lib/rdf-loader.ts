export interface LoadOptions {
  sources: string;
  graphPerFile?: boolean;
}

export async function loadRdf(_options: LoadOptions): Promise<never> {
  throw new Error('loadRdf not yet implemented');
}
