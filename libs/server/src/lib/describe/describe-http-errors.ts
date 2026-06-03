import {
  BadGatewayException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { formatDescribeError, type DescribeTopLevelError } from 'core';

/**
 * Map describe's top-level `Result` error (ADR-0024) to an HTTP exception.
 * Describe targets exactly one source (ADR-0052), so the source's own failure
 * *is* the request failure — there is no `all-sources-failed` aggregate any
 * more. Every body carries a human `message` (via the single-source-of-truth
 * `formatDescribeError`) plus the variant's queryable structured fields.
 *
 * - Real data/upstream failures (`source` load, `endpoint-describe`) → 502.
 * - Precondition / misuse (naming an undescribable source kind, routing
 *   errors) → 400.
 */
export function mapDescribeHttpError(
  error: DescribeTopLevelError,
): HttpException {
  const message = formatDescribeError(error);
  switch (error.kind) {
    case 'source':
      return new BadGatewayException({ kind: 'source', message });
    case 'endpoint-describe':
      return new BadGatewayException({
        kind: 'endpoint-describe',
        endpoint: error.endpoint,
        message,
      });
    case 'empty-source':
      return new BadRequestException({
        kind: 'empty-source',
        id: error.id,
        message,
      });
    case 'reference-source':
      return new BadRequestException({
        kind: 'reference-source',
        id: error.id,
        ref: error.ref,
        message,
      });
    case 'disk-backed-source':
      return new BadRequestException({
        kind: 'disk-backed-source',
        id: error.id,
        message,
      });
    case 'empty-target':
      return new BadRequestException({ kind: 'empty-target', message });
    case 'seed-not-iri':
      return new BadRequestException({
        kind: 'seed-not-iri',
        value: error.value,
        message,
      });
    case 'reference-target':
      return new BadRequestException({ kind: 'reference-target', message });
    case 'no-default-multi':
      return new BadRequestException({
        kind: 'no-default-multi',
        availableIds: [...error.availableIds],
        message,
      });
    case 'expanded-paths-without-source':
      return new BadRequestException({
        kind: 'expanded-paths-without-source',
        message,
      });
    case 'expanded-paths-non-endpoint-source':
      return new BadRequestException({
        kind: 'expanded-paths-non-endpoint-source',
        id: error.id,
        sourceKind: error.sourceKind,
        message,
      });
  }
}
