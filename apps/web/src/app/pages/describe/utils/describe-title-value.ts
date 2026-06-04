import type { DisplayContext } from '@app/core';
import { curieOrIri } from '../../diff/utils/term-display';

/**
 * The describe page title value: the submitted (fully-expanded) seed IRI
 * rendered as a curie via the shared `curieOrIri`, or empty before anything
 * has been described (ADR-0053).
 */
export function describeTitleValue(
  submittedSeed: string,
  ctx: DisplayContext,
): string {
  const iri = submittedSeed.trim();
  if (iri.length === 0) return '';
  return curieOrIri(iri, Object.entries(ctx.prefixes), ctx.base);
}
