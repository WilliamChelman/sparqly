import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { Parser, type Quad } from 'n3';
import { ResultAsync } from 'neverthrow';
import { rdfParser } from 'rdf-parse';
import type { GlobLoadError } from '../sources/errors';

export interface RdfRecord {
  quad: Quad;
  line?: number;
  /**
   * Last source line of the predicate-object pair when the object spans
   * multiple lines (triple-quoted literal, multi-line `( … )` list,
   * multi-line `[ … ]` blank node). Absent for single-line records.
   */
  endLine?: number;
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
const END_LINE_KEY = '__sparqlyEndLine';

type WithLine = Quad & { [LINE_KEY]?: number; [END_LINE_KEY]?: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const N3ParserBase = Parser as unknown as new (opts?: unknown) => any;

class LineTrackingParser extends N3ParserBase {
  _currentLine: number | undefined;
  _currentEndLine: number | undefined;
  /**
   * Stack of opening-line numbers for `(` and `[` constructs whose object
   * could span multiple source lines. Pushed on `(` / `[` and popped on the
   * matching `)` / `]`; the popped value becomes the start line for the
   * enclosing parent triple.
   */
  _enclosureStarts: number[] = [];

  _readPredicate(token: { line: number }) {
    this._currentLine = token.line;
    this._currentEndLine = undefined;
    return super._readPredicate(token);
  }

  _readObject(token: { line: number; type: string }) {
    this._currentLine = token.line;
    this._currentEndLine = undefined;
    if (token.type === '(' || token.type === '[') {
      this._enclosureStarts.push(token.line);
    }
    const next = super._readObject(token);
    if (token.type === 'literal') {
      // For triple-quoted literals, the lexer advances `_line` by the number
      // of newlines inside the literal; for single-line literals it does not.
      // Capturing _line right after super consumed the literal token gives
      // the line of the closing quote.
      const after = (this as unknown as { _lexer: { _line: number } })._lexer._line;
      if (after > token.line) this._currentEndLine = after;
    }
    return next;
  }

  _readListItem(token: { line: number; type: string }) {
    // The closing `)` is pure punctuation — quads emitted on its read
    // (the rdf:rest -> rdf:nil terminator) belong on the last item's line,
    // not the closing-paren line. The parent triple is emitted later in
    // `_readPunctuation`; we annotate it with the enclosing list's range.
    if (token.type !== ')') {
      this._currentLine = token.line;
      this._currentEndLine = undefined;
      if (token.type === '(' || token.type === '[') {
        this._enclosureStarts.push(token.line);
      }
    }
    const next = super._readListItem(token);
    if (token.type === ')') {
      const start = this._enclosureStarts.pop();
      if (start !== undefined && start !== token.line) {
        this._currentLine = start;
        this._currentEndLine = token.line;
      }
    }
    return next;
  }

  _readBlankNodeTail(token: { line: number; type: string }) {
    const next = super._readBlankNodeTail(token);
    if (token.type === ']') {
      const start = this._enclosureStarts.pop();
      // Only annotate the parent triple when the bnode was an object (parent
      // subject + object are restored after `]`); for `[]` in subject
      // position we leave `_currentLine` alone.
      const parentSubject = (this as unknown as { _subject: unknown })._subject;
      const parentObject = (this as unknown as { _object: unknown })._object;
      if (
        start !== undefined &&
        start !== token.line &&
        parentSubject !== null &&
        parentObject !== null
      ) {
        this._currentLine = start;
        this._currentEndLine = token.line;
      }
    }
    return next;
  }

  _emit(s: unknown, p: unknown, o: unknown, g: unknown) {
    const quad: WithLine = this['_factory'].quad(s, p, o, g || this['DEFAULTGRAPH']);
    quad[LINE_KEY] = this._currentLine;
    if (this._currentEndLine !== undefined) {
      quad[END_LINE_KEY] = this._currentEndLine;
    }
    this['_callback'](null, quad);
  }
}

export interface ParseRdfFileOptions {
  /**
   * Buffer of raw file content. When provided, the parser uses this content
   * instead of reading `path` from disk; the `path` is still used for
   * extension detection, base-IRI, and error attribution (ADR-0029 — pinned
   * source content comes from the git tree, not the working tree).
   */
  contentOverride?: Buffer;
}

/**
 * Primary `Result`-typed parser. Failures collapse into a single
 * {@link GlobLoadError} variant carrying the offending file path and the
 * wrapped underlying message (ADR-0024).
 */
export function parseRdfFileResult(
  path: string,
  options: ParseRdfFileOptions = {},
): ResultAsync<ParseFileResult, GlobLoadError> {
  return ResultAsync.fromPromise(parseRdfFile(path, options), (err) => ({
    kind: 'glob-load' as const,
    glob: [path],
    file: path,
    message: err instanceof Error ? err.message : String(err),
  }));
}

/**
 * @deprecated Use {@link parseRdfFileResult} (ADR-0024). Retained as a thin
 * throw-based adapter for callers that have not migrated yet.
 */
export async function parseRdfFile(
  path: string,
  options: ParseRdfFileOptions = {},
): Promise<ParseFileResult> {
  const ext = extname(path).toLowerCase();
  if (ext in N3_FORMAT_BY_EXT) {
    return parseWithN3(path, N3_FORMAT_BY_EXT[ext], options.contentOverride);
  }
  if (ext in RDF_PARSE_FORMAT_BY_EXT) {
    return parseWithRdfParse(
      path,
      RDF_PARSE_FORMAT_BY_EXT[ext],
      options.contentOverride,
    );
  }
  throw new Error(`Unsupported file extension: ${path}`);
}

function parseWithN3(
  path: string,
  format: string,
  contentOverride: Buffer | undefined,
): Promise<ParseFileResult> {
  const records: RdfRecord[] = [];
  const prefixes: Record<string, string> = {};
  const parser = new LineTrackingParser({ format });

  return new Promise((resolve, reject) => {
    const onQuad = (err: Error | null, quad?: WithLine): void => {
      if (err) {
        reject(err);
        return;
      }
      if (quad) {
        const rec: RdfRecord = { quad, line: quad[LINE_KEY] };
        if (quad[END_LINE_KEY] !== undefined) rec.endLine = quad[END_LINE_KEY];
        records.push(rec);
      } else {
        resolve({ records, prefixes });
      }
    };
    const onPrefix = (prefix: string, iri: { value: string }): void => {
      if (prefix && iri) prefixes[prefix] = iri.value;
    };

    if (contentOverride !== undefined) {
      parser['parse'](contentOverride.toString('utf8'), { onQuad, onPrefix });
      return;
    }

    const stream = createReadStream(path, { encoding: 'utf8' });
    let parseError: Error | null = null;
    stream.on('error', reject);
    parser['parse'](stream, {
      onQuad: (err: Error | null, quad?: WithLine) => {
        if (err) {
          parseError = err;
          return;
        }
        if (quad) {
          const rec: RdfRecord = { quad, line: quad[LINE_KEY] };
          if (quad[END_LINE_KEY] !== undefined) rec.endLine = quad[END_LINE_KEY];
          records.push(rec);
        }
      },
      onPrefix,
    });
    stream.on('end', () => {
      if (parseError) reject(parseError);
      else resolve({ records, prefixes });
    });
  });
}

function parseWithRdfParse(
  path: string,
  contentType: string,
  contentOverride: Buffer | undefined,
): Promise<ParseFileResult> {
  const records: RdfRecord[] = [];
  const prefixes: Record<string, string> = {};
  return new Promise((resolve, reject) => {
    const input =
      contentOverride !== undefined
        ? Readable.from(contentOverride)
        : createReadStream(path);
    input.on('error', reject);
    rdfParser
      .parse(input, { contentType, baseIRI: `file://${path}` })
      .on('data', (quad: Quad) => records.push({ quad, line: undefined }))
      .on('prefix', (prefix: string, iri: { value: string }) => {
        if (prefix && iri?.value) prefixes[prefix] = iri.value;
      })
      .on('error', reject)
      .on('end', () => resolve({ records, prefixes }));
  });
}
