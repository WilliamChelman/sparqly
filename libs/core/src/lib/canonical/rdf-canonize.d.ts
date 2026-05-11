declare module 'rdf-canonize' {
  interface CanonizeOptions {
    algorithm: 'RDFC-1.0' | string;
    format?: 'application/n-quads' | string;
    canonicalIdMap?: Map<string, string>;
  }
  export function canonize(
    quads: ReadonlyArray<unknown>,
    options: CanonizeOptions,
  ): Promise<string>;
}
