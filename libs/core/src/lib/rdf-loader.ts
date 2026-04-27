import { readFile } from 'node:fs/promises';
import { Parser, Store } from 'n3';
import { glob } from 'tinyglobby';

export interface LoadOptions {
  sources: string | string[];
  graphPerFile?: boolean;
}

export interface LoadResult {
  store: Store;
  files: string[];
}

export async function loadRdf(options: LoadOptions): Promise<LoadResult> {
  const files = await glob(options.sources, { absolute: true });

  if (files.length === 0) {
    throw new Error(
      `No files matched sources: ${
        Array.isArray(options.sources)
          ? options.sources.join(', ')
          : options.sources
      }`,
    );
  }

  const store = new Store();

  for (const file of files) {
    const contents = await readFile(file, 'utf8');
    try {
      const quads = new Parser().parse(contents);
      store.addQuads(quads);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse ${file}: ${message}`);
    }
  }

  return { store, files };
}
