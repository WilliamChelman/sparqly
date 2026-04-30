import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { DataFactory, Store, type DefaultGraph, type NamedNode, type Quad } from 'n3';
import { rdfParser } from 'rdf-parse';
import { glob } from 'tinyglobby';

export const GRAPH_STRATEGIES = [
  'default',
  'partial',
  'full',
  'none',
] as const;

export type GraphStrategy = (typeof GRAPH_STRATEGIES)[number];

export interface LoadOptions {
  sources: string | string[];
  graphStrategy?: GraphStrategy;
}

export interface LoadResult {
  store: Store;
  files: string[];
  /** Prefixes declared in each parsed file, keyed by absolute file path. */
  prefixes: Record<string, Record<string, string>>;
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

  const strategy: GraphStrategy = options.graphStrategy ?? 'default';
  const store = new Store();
  const prefixes: Record<string, Record<string, string>> = {};

  for (const file of files) {
    const contentType = contentTypeFor(file);
    if (!contentType) {
      throw new Error(`Unsupported file extension: ${file}`);
    }
    try {
      prefixes[file] = await parseFileInto(file, contentType, store, strategy);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse ${file}: ${message}`);
    }
  }

  return { store, files, prefixes };
}

function contentTypeFor(file: string): string | undefined {
  return EXTENSION_TO_CONTENT_TYPE[extname(file).toLowerCase()];
}

function targetGraph(
  quad: Quad,
  strategy: GraphStrategy,
  fileGraph: NamedNode,
): NamedNode | DefaultGraph | undefined {
  if (strategy === 'none') return DataFactory.defaultGraph();
  if (strategy === 'full') return fileGraph;
  if (strategy === 'partial' && quad.graph.termType === 'DefaultGraph') {
    return fileGraph;
  }
  return undefined;
}

function parseFileInto(
  file: string,
  contentType: string,
  store: Store,
  strategy: GraphStrategy,
): Promise<Record<string, string>> {
  const fileGraph = DataFactory.namedNode(`file://${file}`);
  const filePrefixes: Record<string, string> = {};
  return new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('error', reject);
    rdfParser
      .parse(stream, { contentType, baseIRI: `file://${file}` })
      .on('data', (quad: Quad) => {
        const target = targetGraph(quad, strategy, fileGraph);
        const out = target
          ? DataFactory.quad(quad.subject, quad.predicate, quad.object, target)
          : quad;
        store.addQuad(out);
      })
      .on('prefix', (prefix: string, iri: NamedNode) => {
        if (prefix && iri?.value) filePrefixes[prefix] = iri.value;
      })
      .on('error', reject)
      .on('end', () => resolve(filePrefixes));
  });
}
