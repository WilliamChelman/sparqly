const BRAND = 'sparqly';

/**
 * Assemble a document title as `value — Page — sparqly`, collapsing to
 * `Page — sparqly` when there is no meaningful value. The single place the
 * em-dash join and brand suffix live (ADR-0053).
 */
export function pageTitle(value: string | null, page: string): string {
  const trimmed = value?.trim() ?? '';
  return [trimmed, page, BRAND].filter((part) => part.length > 0).join(' — ');
}
