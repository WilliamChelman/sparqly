import type { Term, Writer } from 'n3';
import { XSD_STRING } from './shorten-nquad-line';

const RDF_LANG_STRING =
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString';

interface LiteralLike {
  value: string;
  language?: string;
  datatype?: { value: string };
}

interface WriterInternals {
  _encodeLiteral(literal: LiteralLike): string;
  _encodeIriOrBlank(t: Term): string;
}

export function installMultilineLiteralEncoder(writer: Writer): void {
  const internals = writer as unknown as WriterInternals;
  const fallback = internals._encodeLiteral.bind(writer);
  internals._encodeLiteral = function (literal: LiteralLike): string {
    if (!shouldEmitMultiline(literal)) return fallback(literal);
    const body = `"""${escapeMultilineBody(literal.value)}"""`;
    if (literal.language) return `${body}@${literal.language}`;
    if (literal.datatype && literal.datatype.value !== XSD_STRING) {
      const dt = internals._encodeIriOrBlank(
        literal.datatype as unknown as Term,
      );
      return `${body}^^${dt}`;
    }
    return body;
  };
}

function shouldEmitMultiline(literal: LiteralLike): boolean {
  if (!literal.value.includes('\n')) return false;
  if (literal.language) return true;
  const dt = literal.datatype?.value;
  return !dt || dt === XSD_STRING || dt === RDF_LANG_STRING;
}

function escapeMultilineBody(value: string): string {
  const withBackslashes = value.replace(/\\/g, '\\\\');
  let result = '';
  let i = 0;
  while (i < withBackslashes.length) {
    const ch = withBackslashes[i];
    if (ch !== '"') {
      result += ch;
      i++;
      continue;
    }
    let j = i;
    while (j < withBackslashes.length && withBackslashes[j] === '"') j++;
    const runLen = j - i;
    const atEnd = j === withBackslashes.length;
    const raw = atEnd ? 0 : Math.min(runLen, 2);
    const escaped = runLen - raw;
    result += '"'.repeat(raw) + '\\"'.repeat(escaped);
    i = j;
  }
  return result;
}
