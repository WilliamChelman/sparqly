import dedent from 'dedent';
import { parseRdfString, type ParsedRdfString } from '../parse-rdf-string';

export function ttl(
  strings: TemplateStringsArray,
  ...values: unknown[]
): ParsedRdfString {
  return parseRdfString(dedent(strings, ...values));
}
