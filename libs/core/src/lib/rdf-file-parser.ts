import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { Parser, type Quad } from 'n3';
import { rdfParser } from 'rdf-parse';

export interface RdfRecord {
  quad: Quad;
  line?: number;
}

export interface ParseFileResult {
  records: RdfRecord[];
  prefixes: Record<string, string>;
}

const N3_FORMAT_BY_EXT: Record<string, string> = {
  '.ttl': 'text/turtle',
  '.turtle': 'text/turtle',
  '.nt': 'application/n-triples',
  '.ntriples': 'application/n-triples',
  '.nq': 'application/n-quads',
  '.nquads': 'application/n-quads',
  '.trig': 'application/trig',
};

const RDF_PARSE_FORMAT_BY_EXT: Record<string, string> = {
  '.jsonld': 'application/ld+json',
  '.rdf': 'application/rdf+xml',
  '.rdfxml': 'application/rdf+xml',
  '.owl': 'application/rdf+xml',
  '.xml': 'application/rdf+xml',
};

const LINE_KEY = '__sparqlyLine';

type WithLine = Quad & { [LINE_KEY]?: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const N3ParserBase = Parser as unknown as new (opts?: unknown) => any;

class LineTrackingParser extends N3ParserBase {
  _currentLine: number | undefined;

  _readPredicate(token: { line: number }) {
    this._currentLine = token.line;
    return super._readPredicate(token);
  }

  _emit(s: unknown, p: unknown, o: unknown, g: unknown) {
    const quad: WithLine = this['_factory'].quad(s, p, o, g || this['DEFAULTGRAPH']);
    quad[LINE_KEY] = this._currentLine;
    this['_callback'](null, quad);
  }
}

export async function parseRdfFile(path: string): Promise<ParseFileResult> {
  const ext = extname(path).toLowerCase();
  if (ext in N3_FORMAT_BY_EXT) return parseWithN3(path, N3_FORMAT_BY_EXT[ext]);
  if (ext in RDF_PARSE_FORMAT_BY_EXT) {
    return parseWithRdfParse(path, RDF_PARSE_FORMAT_BY_EXT[ext]);
  }
  throw new Error(`Unsupported file extension: ${path}`);
}

async function parseWithN3(path: string, format: string): Promise<ParseFileResult> {
  const text = await readFile(path, 'utf8');
  const prefixes: Record<string, string> = {};
  const parser = new LineTrackingParser({ format });
  const quads: Quad[] = parser['parse'](
    text,
    null,
    (prefix: string, iri: { value: string }) => {
      if (prefix && iri) prefixes[prefix] = iri.value;
    },
  );
  const records: RdfRecord[] = quads.map((quad) => ({
    quad,
    line: (quad as WithLine)[LINE_KEY],
  }));
  return { records, prefixes };
}

function parseWithRdfParse(path: string, contentType: string): Promise<ParseFileResult> {
  const records: RdfRecord[] = [];
  const prefixes: Record<string, string> = {};
  return new Promise((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('error', reject);
    rdfParser
      .parse(stream, { contentType, baseIRI: `file://${path}` })
      .on('data', (quad: Quad) => records.push({ quad, line: undefined }))
      .on('prefix', (prefix: string, iri: { value: string }) => {
        if (prefix && iri?.value) prefixes[prefix] = iri.value;
      })
      .on('error', reject)
      .on('end', () => resolve({ records, prefixes }));
  });
}
