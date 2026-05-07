import { bestPrefixEntryFor, shortenNQuadLine } from 'common';
import type { Hunk, HunkedRdfDiff, HunkLine } from './group-rdf-diff-by-entity';

export interface FormatGroupedRdfDiffOptions {
  prefixes: Record<string, string>;
}

export function formatGroupedRdfDiff(
  hunked: HunkedRdfDiff,
  options: FormatGroupedRdfDiffOptions,
): string {
  const totalRemoved = hunked.hunks.reduce((acc, h) => acc + h.removed, 0);
  const totalAdded = hunked.hunks.reduce((acc, h) => acc + h.added, 0);
  const summary = `# left=${hunked.totals.left} right=${hunked.totals.right} +${totalAdded} -${totalRemoved}\n`;
  const parts: string[] = [summary];
  const prefixEntries = Object.entries(options.prefixes);
  for (const hunk of hunked.hunks) {
    const anchorDisplay = curieOrIri(hunk.anchor, prefixEntries);
    parts.push(renderHunkHeader(hunk, anchorDisplay, prefixEntries));
    for (const line of hunk.lines) {
      parts.push(renderHunkLine(line, anchorDisplay, options.prefixes));
    }
  }
  return parts.join('');
}

function renderHunkHeader(
  hunk: Hunk,
  anchorDisplay: string,
  prefixEntries: ReadonlyArray<[string, string]>,
): string {
  const typeSuffix =
    hunk.rdfType !== undefined
      ? `  (${curieOrIri(hunk.rdfType, prefixEntries)})`
      : '';
  return `${anchorDisplay}${typeSuffix}  [-${hunk.removed} +${hunk.added}]\n`;
}

function renderHunkLine(
  line: HunkLine,
  anchorDisplay: string,
  prefixes: Record<string, string>,
): string {
  const shortened = shortenNQuadLine(line.nquad, { prefixes });
  // Subject elision: when the shortened line begins with the anchor's display
  // form, drop the leading token + space so the body reads `pred obj .`.
  const prefix = `${anchorDisplay} `;
  const body = shortened.startsWith(prefix)
    ? shortened.slice(prefix.length)
    : shortened;
  return `${line.side} ${body}\n`;
}

function curieOrIri(
  iri: string,
  entries: ReadonlyArray<[string, string]>,
): string {
  const match = bestPrefixEntryFor(iri, entries);
  if (match === undefined) return `<${iri}>`;
  const [name, ns] = match;
  return `${name}:${iri.slice(ns.length)}`;
}
