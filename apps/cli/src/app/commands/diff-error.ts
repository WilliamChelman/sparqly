import { formatDiffError, type DiffError, type SourceError } from 'core';

/**
 * Per-variant exit-code map. Stable across releases — scripts grep on these.
 *
 *   0   no diff (handler returns normally)
 *   1   diff present (DiffPresentSignal — see diff.ts)
 *   2   unknown error (fallthrough)
 *  10   tabular-blank-node               (shape)
 *  11   unknown-source-id                (registry lookup)
 *  12   mixed-shape                      (shape)
 *  13   set-mismatch                     (shape)
 *  14   endpoint-as-diff-target          (shape)
 *  15   inline-upstream-kind             (shape)
 *  20   anonymous-view-execution         (transport / upstream)
 *  21   anonymous-select-execution       (transport / upstream)
 *  30   source: reference-target         (config invariant — bug)
 *  31   source: legacy-message           (unconverted leaf throw)
 *  32   source: glob-load                (file/glob load failure)
 *  33   source: query-execution          (SPARQL execution failure)
 *  34   source: endpoint-fetch           (remote endpoint failure)
 *  35   source: view-validation          (view query validation failure)
 *  36   source: view-reference           (view from: ref / cycle / unsupported upstream)
 *  37   source: cache-io                 (view cache read/write/parse failure)
 *  40   legacy-message                   (top-level unconverted throw)
 */
export function diffErrorExitCode(error: DiffError): number {
  switch (error.kind) {
    case 'tabular-blank-node':
      return 10;
    case 'unknown-source-id':
      return 11;
    case 'mixed-shape':
      return 12;
    case 'set-mismatch':
      return 13;
    case 'endpoint-as-diff-target':
      return 14;
    case 'inline-upstream-kind':
      return 15;
    case 'anonymous-view-execution':
      return 20;
    case 'anonymous-select-execution':
      return 21;
    case 'source':
      return sourceErrorExitCode(error.source);
    case 'legacy-message':
      return 40;
  }
}

function sourceErrorExitCode(error: SourceError): number {
  switch (error.kind) {
    case 'reference-target':
      return 30;
    case 'legacy-message':
      return 31;
    case 'glob-load':
      return 32;
    case 'query-execution':
      return 33;
    case 'endpoint-fetch':
      return 34;
    case 'view-validation':
      return 35;
    case 'view-reference':
      return 36;
    case 'cache-io':
      return 37;
  }
}

export interface DecorateOptions {
  /** When true, wrap the formatter output in red ANSI escapes. */
  color: boolean;
}

const ANSI_RED = '\x1b[31m';
const ANSI_RESET = '\x1b[0m';

/**
 * CLI-side decoration around the shared `formatDiffError`. Keeps wording
 * single-sourced in core and lets the CLI add terminal-only colour. ADR-0024.
 */
export function decorateDiffError(
  error: DiffError,
  { color }: DecorateOptions,
): string {
  const body = formatDiffError(error);
  return color ? `${ANSI_RED}${body}${ANSI_RESET}` : body;
}

/**
 * Silent wrapper carried out of the diff handler so the runner skips its
 * default `error: <message>` line — the CLI itself writes the ANSI-decorated
 * `formatDiffError` body and uses `diffSpec.exitCode` to route the variant
 * through `diffErrorExitCode`.
 */
export class DiffErrorSignal extends Error {
  readonly silent = true;
  constructor(public readonly diffError: DiffError) {
    super(formatDiffError(diffError));
    this.name = 'DiffErrorSignal';
  }
}
