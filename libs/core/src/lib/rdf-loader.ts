import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { DataFactory, Store, type Quad } from 'n3';
import { rdfParser } from 'rdf-parse';
import { glob } from 'tinyglobby';

export interface LoadOptions {
  sources: string | string[];
  graphPerFile?: boolean;
}

export interface LoadResult {
  store: Store;
  files: string[];
}

const EXTENSION_TO_CONTENT_TYPE: Record<string, string> = {
  '.ttl': 'text/turtle',
  '.turtle': 'text/turtle',
  '.nt': 'application/n-triples',
  '.ntriples': 'application/n-triples',
  '.nq': 'application/n-quads',
  '.nquads': 'application/n-quads',
  '.trig': 'application/trig',
  '.jsonld': 'application/ld+json',
  '.rdf': 'application/rdf+xml',
  '.rdfxml': 'application/rdf+xml',
  '.owl': 'application/rdf+xml',
  '.xml': 'application/rdf+xml',
};

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
    const contentType = contentTypeFor(file);
    if (!contentType) {
      throw new Error(`Unsupported file extension: ${file}`);
    }
    const graphOverride = options.graphPerFile
      ? DataFactory.namedNode(`file://${file}`)
      : undefined;
    try {
      await parseFileInto(file, contentType, store, graphOverride);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse ${file}: ${message}`);
    }
  }

  return { store, files };
}

function contentTypeFor(file: string): string | undefined {
  return EXTENSION_TO_CONTENT_TYPE[extname(file).toLowerCase()];
}

function parseFileInto(
  file: string,
  contentType: string,
  store: Store,
  graphOverride?: ReturnType<typeof DataFactory.namedNode>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('error', reject);
    rdfParser
      .parse(stream, { contentType, baseIRI: `file://${file}` })
      .on('data', (quad: Quad) => {
        const out = graphOverride
          ? DataFactory.quad(
              quad.subject,
              quad.predicate,
              quad.object,
              graphOverride,
            )
          : quad;
        store.addQuad(out);
      })
      .on('error', reject)
      .on('end', resolve);
  });
}
