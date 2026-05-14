import {
  formatTargetError,
  type TargetError,
} from 'core';

/**
 * The snippet feature folder's error union (ADR-0024). Every variant is a
 * tagged object so the controller, its HTTP mapper, and the webapp renderer
 * can switch on `kind` and keep the structured payload (e.g. `file` and
 * `reason` for UI presentation of a moved/missing source file). Adding a
 * variant is one edit here plus one new case in `formatSnippetError`.
 *
 * `target` wraps the cross-feature `TargetError` per ADR-0024's
 * wrap-don't-duplicate rule, reserved for future source-id resolution at the
 * snippet endpoint. Registry-selection failures live in `target/errors.ts`
 * and are rendered here by delegation to `formatTargetError`.
 */
export type SnippetError =
  | TargetWrappedError
  | FileReadError
  | RangeMalformedError
  | RangeOutOfBoundsError;

export interface TargetWrappedError {
  kind: 'target';
  target: TargetError;
}

/**
 * Request-time filesystem failure on an allow-listed file: the loader saw
 * the path but the file has since moved, been deleted, or is no longer a
 * regular file. `reason` mirrors the underlying fs failure mode so the
 * webapp can render path + reason rather than crashing.
 */
export interface FileReadError {
  kind: 'file-read';
  /** Absolute path of the file the snippet endpoint tried to read. */
  file: string;
  reason: 'missing' | 'not-a-file' | 'io';
}

/**
 * A `range=` query parameter failed structural parsing: not a `<line>` or
 * `<start>-<end>` spec, a non-positive integer, or `end < start`. `spec` is
 * the offending raw string and `reason` names the structural fault.
 */
export interface RangeMalformedError {
  kind: 'range-malformed';
  spec: string;
  reason: 'shape' | 'end-before-start' | 'non-positive';
}

/**
 * A syntactically valid `range=` spec referred to a line number past the
 * file's last line (or the file was empty).
 */
export interface RangeOutOfBoundsError {
  kind: 'range-out-of-bounds';
  spec: string;
}

export function formatSnippetError(error: SnippetError): string {
  switch (error.kind) {
    case 'target':
      return formatTargetError(error.target);
    case 'file-read':
      return `cannot read source snippet from ${error.file}: ${error.reason}`;
    case 'range-malformed':
      return `\`range\` "${error.spec}" is malformed: ${error.reason}`;
    case 'range-out-of-bounds':
      return `\`range\` "${error.spec}" points past end of file`;
  }
}
