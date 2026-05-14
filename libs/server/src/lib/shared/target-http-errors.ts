import { HttpStatus } from '@nestjs/common';
import type { TargetError } from 'core';

/**
 * Per-variant status mapping for the cross-feature `TargetError` union.
 * Allowed in `libs/server/shared/` because `TargetError` is owned by
 * `libs/core` (ADR-0024): a reusable sub-mapper consumed by per-feature HTTP
 * mapper modules, not a global Nest exception filter.
 *
 * Every variant is a user-input registry-selection error and maps to 400:
 *
 *   ref-as-target     user picked a `reference` alias as data
 *   empty-registry    user gave no target and no sources are configured
 *   no-default-multi  user gave no target with ambiguous registry
 *   unknown-ref       user referenced an `@id` that does not exist
 */
export function targetErrorToStatus(error: TargetError): HttpStatus {
  switch (error.kind) {
    case 'ref-as-target':
      return HttpStatus.BAD_REQUEST;
    case 'empty-registry':
      return HttpStatus.BAD_REQUEST;
    case 'no-default-multi':
      return HttpStatus.BAD_REQUEST;
    case 'unknown-ref':
      return HttpStatus.BAD_REQUEST;
  }
}
