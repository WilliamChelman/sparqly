import { canonize } from 'rdf-canonize';
import type { Store } from 'n3';
import { loadRdf, type GraphMode } from './rdf-loader';

export interface CanonicalizeOptions {
  sources: string | string[];
  graphMode?: GraphMode;
}

export interface CanonicalizeStoreResult {
  /** RDFC-1.0 canonical N-Quads, joined with '\n' and a trailing newline. */
  canonicalText: string;
  /** Canonical N-Quads statements, one element per quad, no trailing newline. */
  canonicalStatements: string[];
}

export interface CanonicalizeResult extends CanonicalizeStoreResult {
  files: string[];
  store: Store;
  /** Prefixes declared in each parsed file, keyed by absolute file path. */
  prefixes: Record<string, Record<string, string>>;
}

export async function canonicalizeStore(
  store: Store,
): Promise<CanonicalizeStoreResult> {
  const canonicalText = await canonize(
    store.getQuads(null, null, null, null),
    { algorithm: 'RDFC-1.0', format: 'application/n-quads' },
  );
  const canonicalStatements = canonicalText
    .split('\n')
    .filter((line: string) => line.length > 0);
  return { canonicalText, canonicalStatements };
}

export async function canonicalizeRdf(
  options: CanonicalizeOptions,
): Promise<CanonicalizeResult> {
  const { store, files, prefixes } = await loadRdf({
    sources: options.sources,
    graphMode: options.graphMode,
  });
  const { canonicalText, canonicalStatements } = await canonicalizeStore(store);
  return { files, store, prefixes, canonicalText, canonicalStatements };
}
