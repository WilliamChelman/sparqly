import { bestPrefixEntryFor, shortenNQuadLine } from 'common';
import type {
  BnodePathStep,
  Hunk,
  HunkedRdfDiff,
  HunkLine,
} from './group-rdf-diff-by-entity';

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
  if (line.bnodePath !== undefined && line.bnodePath.length > 0) {
    return `${line.side} ${renderAbsorbedBnodeLine(line, prefixes)}\n`;
  }
  const shortened = shortenNQuadLine(line.nquad, { prefixes });
  // Subject elision: when the shortened line begins with the anchor's display
  // form, drop the leading token + space so the body reads `pred obj .`.
  const prefix = `${anchorDisplay} `;
  const body = shortened.startsWith(prefix)
    ? shortened.slice(prefix.length)
    : shortened;
  return `${line.side} ${body}\n`;
}

function renderAbsorbedBnodeLine(
  line: HunkLine,
  prefixes: Record<string, string>,
): string {
  const prefixEntries = Object.entries(prefixes);
  const path = line.bnodePath as BnodePathStep[];
  // Each step renders as either `[<idPredicate-curie> <idValue-curie>]` (when
  // sh:path or another identity predicate is present) or `_:<rawLabel>` (the
  // canonical-bnode-label fallback). Hops are separated by ` / `, then a final
  // ` / ` joins the last hop's identity to the line's predicate+object.
  const segments = path.map((step) => {
    if (step.identityIsBlank) {
      return step.identityValue;
    }
    const idPredicateCurie = curieOrIri(
      step.identityPredicate ?? '',
      prefixEntries,
    );
    const idValueDisplay = renderIdentityValue(step.identityValue, prefixEntries);
    return `[${idPredicateCurie} ${idValueDisplay}]`;
  });
  // Render the predicate and object via the same shortener used by other lines
  // so prefix handling stays in one place.
  const shortened = shortenNQuadLine(line.nquad, { prefixes });
  // Drop the subject token (everything up to the first space) — the path
  // notation replaces it.
  const firstSpace = shortened.indexOf(' ');
  const tail = firstSpace >= 0 ? shortened.slice(firstSpace + 1) : shortened;
  return `${segments.join(' / ')} / ${tail}`;
}

function renderIdentityValue(
  value: string,
  prefixEntries: ReadonlyArray<[string, string]>,
): string {
  // Heuristic: identity values are NamedNode IRIs in SHACL (sh:path → IRI).
  // Literal-valued sh:path is unusual but supported by serializeObject's
  // output (which yields `"lex"`-style strings). We detect the IRI shape by
  // absence of leading `"` / `_:` and pass through otherwise.
  if (value.startsWith('"') || value.startsWith('_:') || value.startsWith('<')) {
    return value;
  }
  // Try to parse as an IRI to confirm it has a scheme; if so, CURIE-shorten.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    return curieOrIri(value, prefixEntries);
  }
  return value;
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
