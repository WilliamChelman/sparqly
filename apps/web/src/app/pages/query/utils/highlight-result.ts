import {
  exceedsHighlightThreshold,
  resolveHighlightMode,
  tokenizeCode,
  type CodeLine,
} from '@app/modules/code-highlight';

/**
 * Build the `raw`-tab highlight model for a wire body. Returns `null` when the
 * content type has no recognised mode or the body is over the size threshold —
 * the caller renders plain text in that case.
 */
export function highlightRaw(
  raw: string,
  contentType: string,
): CodeLine[] | null {
  const mode = resolveHighlightMode(contentType);
  if (!mode || exceedsHighlightThreshold(raw)) return null;
  return tokenizeCode(raw, mode);
}

/**
 * Build the `turtle`/`trig`-tab highlight model for a formatted body. The mode
 * is fixed to `turtle` — CodeMirror's turtle mode tokenises TriG too — so only
 * the size threshold can veto highlighting.
 */
export function highlightFormatted(body: string): CodeLine[] | null {
  if (exceedsHighlightThreshold(body)) return null;
  return tokenizeCode(body, 'turtle');
}
