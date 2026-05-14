import {
  BadGatewayException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import type { DescribeError, DescribeTopLevelError } from 'core';

/**
 * Per-ADR-0024 / ADR-0025 mapper from the describe service's top-level error
 * union to `HttpException`. `all-sources-failed` is the only 5xx variant
 * (502, every selected source failed); the three precondition variants
 * (`empty-target`, `seed-not-iri`, `reference-target`) map to 400. Per-source
 * resolution failures live inside the ok payload's `perSource[id].error?`
 * and are not routed through this mapper.
 */
export function mapDescribeHttpError(
  error: DescribeTopLevelError,
): HttpException {
  switch (error.kind) {
    case 'all-sources-failed':
      return new BadGatewayException({
        kind: 'all-sources-failed',
        perSource: clonePerSource(error.perSource),
      });
    case 'empty-target':
      return new BadRequestException({ kind: 'empty-target' });
    case 'seed-not-iri':
      return new BadRequestException({
        kind: 'seed-not-iri',
        value: error.value,
      });
    case 'reference-target':
      return new BadRequestException({ kind: 'reference-target' });
  }
}

function clonePerSource(
  perSource: Readonly<Record<string, DescribeError>>,
): Record<string, DescribeError> {
  const out: Record<string, DescribeError> = {};
  for (const [id, e] of Object.entries(perSource)) {
    out[id] = cloneDescribeError(e);
  }
  return out;
}

function cloneDescribeError(error: DescribeError): DescribeError {
  switch (error.kind) {
    case 'source':
      return { kind: 'source', source: { ...error.source } };
    case 'endpoint-describe':
      return {
        kind: 'endpoint-describe',
        endpoint: error.endpoint,
        message: error.message,
      };
    case 'empty-source':
      return { kind: 'empty-source', id: error.id };
    case 'reference-source':
      return { kind: 'reference-source', id: error.id, ref: error.ref };
  }
}
