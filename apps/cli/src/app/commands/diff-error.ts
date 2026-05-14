import {
  formatDiffError,
  type DiffError,
  type SourceError,
  type TargetError,
} from 'core';

/**
 * Per-variant exit-code map. Stable across releases — scripts grep on these.
 *
 *   0   no diff (handler returns normally)
 *   1   diff present (DiffPresentSignal — see diff.ts)
 *   2   unknown error (fallthrough)
 *  10   tabular-blank-node               (shape)
 *  12   mixed-shape                      (shape)
 *  13   set-mismatch                     (shape)
 *  14   endpoint-as-diff-target          (shape)
 *  15   inline-upstream-kind             (shape)
 *  20   anonymous-view-execution         (transport / upstream)
 *  21   anonymous-select-execution       (transport / upstream)
 *  30   source: reference-target         (config invariant — bug)
 *  32   source: glob-load                (file/glob load failure)
 *  33   source: query-execution          (SPARQL execution failure)
 *  34   source: endpoint-fetch           (remote endpoint failure)
 *  35   source: view-validation          (view query validation failure)
 *  36   source: view-reference           (view from: ref / cycle / unsupported upstream)
 *  37   source: cache-io                 (view cache read/write/parse failure)
 *  38   source: transform-parse          (transform spec parse failure)
 *  40   legacy-message                   (top-level unconverted throw)
 *  50   target: ref-as-target            (reference alias picked as data)
 *  51   target: empty-registry           (registry has no entries)
 *  52   target: no-default-multi         (ambiguous registry, no default)
 *  53   target: unknown-ref              (registry lookup miss)
 */
export function diffErrorExitCode(error: DiffError): number {
  switch (error.kind) {
    case 'tabular-blank-node':
      return 10;
    case 'target':
      return targetErrorExitCode(error.target);
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

function targetErrorExitCode(error: TargetError): number {
  switch (error.kind) {
    case 'ref-as-target':
      return 50;
    case 'empty-registry':
      return 51;
    case 'no-default-multi':
      return 52;
    case 'unknown-ref':
      return 53;
  }
}

function sourceErrorExitCode(error: SourceError): number {
  switch (error.kind) {
    case 'reference-target':
      return 30;
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
    case 'transform-parse':
      return 38;
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
