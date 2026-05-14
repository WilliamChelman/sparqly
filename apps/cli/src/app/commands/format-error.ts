import {
  formatSourceError,
  formatTargetError,
  type SourceError,
  type TargetError,
} from 'core';

/**
 * Per-variant exit-code map for `format`. Stable across releases — scripts grep
 * on these. Codes mirror the `diff-error.ts` precedent so the SourceError and
 * TargetError sub-ranges are consistent across CLI commands.
 *
 *   1   generic / unknown error (handler fallthrough — argv-shape throws, etc.)
 *  30   source: reference-target         (config invariant — bug)
 *  32   source: glob-load                (file/glob load failure)
 *  33   source: query-execution          (SPARQL execution failure)
 *  34   source: endpoint-fetch           (remote endpoint failure)
 *  35   source: view-validation          (view query validation failure)
 *  36   source: view-reference           (view from: ref / cycle / unsupported)
 *  37   source: cache-io                 (view cache read/write/parse failure)
 *  38   source: transform-parse          (transform spec parse failure)
 *  50   target: ref-as-target            (reference alias picked as data)
 *  51   target: empty-registry           (registry has no entries)
 *  52   target: no-default-multi         (ambiguous registry, no default)
 *  53   target: unknown-ref              (registry lookup miss)
 */
export function formatErrorExitCode(error: SourceError | TargetError): number {
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

export interface DecorateOptions {
  color: boolean;
}

const ANSI_RED = '\x1b[31m';
const ANSI_RESET = '\x1b[0m';

/**
 * CLI-side decoration around the shared `formatSourceError`/`formatTargetError`.
 * Keeps wording single-sourced in core and lets the CLI add terminal-only
 * colour. ADR-0024.
 */
export function decorateFormatError(
  error: SourceError | TargetError,
  { color }: DecorateOptions,
): string {
  const body = formatFormatError(error);
  return color ? `${ANSI_RED}${body}${ANSI_RESET}` : body;
}

function formatFormatError(error: SourceError | TargetError): string {
  if (isTargetError(error)) return formatTargetError(error);
  return formatSourceError(error);
}

function isTargetError(
  error: SourceError | TargetError,
): error is TargetError {
  switch (error.kind) {
    case 'ref-as-target':
    case 'empty-registry':
    case 'no-default-multi':
    case 'unknown-ref':
      return true;
    default:
      return false;
  }
}

/**
 * Silent wrapper carried out of the format handler so the runner skips its
 * default `error: <message>` line — the CLI itself writes the ANSI-decorated
 * `formatFormatError` body and uses `formatSpec.exitCode` to route the variant
 * through `formatErrorExitCode`.
 */
export class FormatErrorSignal extends Error {
  readonly silent = true;
  constructor(public readonly formatError: SourceError | TargetError) {
    super(formatFormatError(formatError));
    this.name = 'FormatErrorSignal';
  }
}
