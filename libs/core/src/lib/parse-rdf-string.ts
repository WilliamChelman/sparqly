import { Parser, type Quad } from 'n3';

export interface ParseRdfStringOptions {
  format?: 'turtle' | 'trig';
}

export interface ParsedRdfString {
  quads: Quad[];
  prefixes: Record<string, string>;
  base: string | undefined;
}

export function parseRdfString(
  text: string,
  opts: ParseRdfStringOptions = {},
): ParsedRdfString {
  const prefixes: Record<string, string> = {};
  const parser = opts.format
    ? new Parser({ format: N3_FORMAT[opts.format] })
    : new Parser();
  const quads = parser.parse(text, null, (prefix, iri) => {
    if (prefix && iri) prefixes[prefix] = (iri as { value: string }).value;
  });
  return { quads, prefixes, base: extractBase(text) };
}

const BASE_DIRECTIVE_RE = /^\s*@base\s+<([^>]+)>\s*\.\s*$/im;

function extractBase(text: string): string | undefined {
  const match = text.match(BASE_DIRECTIVE_RE);
  return match ? match[1] : undefined;
}

const N3_FORMAT: Record<NonNullable<ParseRdfStringOptions['format']>, string> = {
  turtle: 'text/turtle',
  trig: 'application/trig',
};
