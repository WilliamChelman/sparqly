import CodeMirror from 'codemirror';
import 'codemirror/addon/runmode/runmode';
import 'codemirror/mode/turtle/turtle';
import 'codemirror/mode/javascript/javascript';

/** A language the highlighter knows how to tokenize. */
export type HighlightMode = 'turtle' | 'json';

/** One run of characters sharing a single CodeMirror token style. */
export interface CodeToken {
  /** The exact source text of this run — never altered. */
  readonly text: string;
  /** Space-joined `cm-*` classes for this token, or `''` when unstyled. */
  readonly className: string;
}

/** An ordered list of the tokens on one source line. */
export type CodeLine = readonly CodeToken[];

/**
 * Soft caps above which highlighting is skipped in favour of plain text:
 * highlighting replaces each line with several DOM nodes, so an unbounded
 * result would otherwise freeze the tab (ADR-0039).
 */
export const HIGHLIGHT_MAX_LINES = 4000;
export const HIGHLIGHT_MAX_CHARS = 400_000;

/**
 * Report whether `text` is too large to highlight — over {@link HIGHLIGHT_MAX_CHARS}
 * characters or {@link HIGHLIGHT_MAX_LINES} lines. Input exactly at a limit is
 * allowed; the caller renders plain text when this returns `true`.
 */
export function exceedsHighlightThreshold(text: string): boolean {
  if (text.length > HIGHLIGHT_MAX_CHARS) return true;
  let lineCount = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 && ++lineCount > HIGHLIGHT_MAX_LINES) {
      return true;
    }
  }
  return false;
}

/** Maps a {@link HighlightMode} to the CodeMirror mode spec that handles it. */
const MODE_SPEC: Record<HighlightMode, string> = {
  turtle: 'turtle',
  json: 'application/json',
};

/** Wire content types (sans parameters) that resolve to a highlight mode. */
const CONTENT_TYPE_MODES: Record<string, HighlightMode> = {
  'application/sparql-results+json': 'json',
  'text/turtle': 'turtle',
  'application/n-triples': 'turtle',
  'application/n-quads': 'turtle',
  'application/trig': 'turtle',
};

/** File extensions (sans leading dot) that resolve to a highlight mode. */
const EXTENSION_MODES: Record<string, HighlightMode> = {
  json: 'json',
  jsonld: 'json',
  ttl: 'turtle',
  trig: 'turtle',
  nt: 'turtle',
  nq: 'turtle',
  n3: 'turtle',
};

/**
 * Resolve a wire content type (`text/turtle`, `application/sparql-results+json`)
 * or a file extension (`.ttl`, `.json`) to a {@link HighlightMode}. Content-type
 * parameters and casing are ignored. Anything unrecognized resolves to `null`,
 * so the caller falls back to plain text rather than mis-highlighting.
 */
export function resolveHighlightMode(
  contentTypeOrExtension: string,
): HighlightMode | null {
  const value = contentTypeOrExtension.trim().toLowerCase();
  if (value === '') return null;
  if (value.includes('/')) {
    const mime = value.split(';')[0]?.trim() ?? '';
    return CONTENT_TYPE_MODES[mime] ?? null;
  }
  const ext = value.startsWith('.') ? value.slice(1) : value;
  return EXTENSION_MODES[ext] ?? null;
}

/**
 * Tokenize `text` with the given mode into a per-line token model. Each line
 * is an ordered list of `{ text, className }`; concatenating every token's
 * `text` and joining the lines with `\n` reproduces `text`.
 */
export function tokenizeCode(text: string, mode: HighlightMode): CodeLine[] {
  const lines: CodeToken[][] = [[]];
  CodeMirror.runMode(text, MODE_SPEC[mode], (tokenText, style) => {
    if (tokenText === '\n') {
      lines.push([]);
      return;
    }
    lines[lines.length - 1].push({
      text: tokenText,
      className: tokenClassName(style),
    });
  });
  return lines;
}

/** Turn a CodeMirror token style (`"string"`, `"variable-2"`, …) into classes. */
function tokenClassName(style: string | null | undefined): string {
  if (!style) return '';
  return style
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => `cm-${name}`)
    .join(' ');
}
