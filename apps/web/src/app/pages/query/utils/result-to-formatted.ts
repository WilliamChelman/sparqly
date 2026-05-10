import { type Quad } from 'n3';
import { formatRdf, type FormatSerialization } from 'common';
import type { DisplayContext } from '@app/core';

export interface FormattedResult {
  body: string;
  serialization: FormatSerialization;
}

export function resultToFormatted(
  triples: Iterable<Quad>,
  responsePrefixes: Record<string, string>,
  responseBase: string | undefined,
  displayContext: DisplayContext,
): FormattedResult {
  const quads = Array.from(triples);
  const serialization: FormatSerialization = quads.some(
    (q) => q.graph.termType === 'NamedNode',
  )
    ? 'trig'
    : 'turtle';
  const prefixes = mergePrefixes(responsePrefixes, displayContext.prefixes);
  const base = displayContext.base ?? responseBase;
  const body = formatRdf(quads, serialization, { prefixes, base });
  return { body, serialization };
}

function mergePrefixes(
  response: Record<string, string>,
  context: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [name, iri] of Object.entries(response)) {
    if (!(name in merged)) merged[name] = iri;
  }
  for (const [name, iri] of Object.entries(context)) {
    merged[name] = iri;
  }
  return merged;
}
