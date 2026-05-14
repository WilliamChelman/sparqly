import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { DiffError, SourceError } from 'core';

/**
 * DiffError variants that the diff controller forwards to the mapper instead
 * of returning through the in-band envelope.
 */
export type TransportDiffError = Extract<
  DiffError,
  {
    kind:
      | 'unknown-source-id'
      | 'anonymous-view-execution'
      | 'anonymous-select-execution'
      | 'source';
  }
>;

/** Full mapper input: also accepts bare SourceError for direct callers. */
export type TransportError = TransportDiffError | SourceError;

/**
 * Per-ADR-0024 mapper from the transport-error subset of `DiffError |
 * SourceError` to `HttpException`. Variants that flow through the in-band
 * `{ kind: 'error', errors: { left?, right?, top? } }` envelope are not
 * passed through this mapper.
 */
export function mapDiffHttpError(error: TransportError): HttpException {
  switch (error.kind) {
    case 'unknown-source-id':
      return new BadRequestException({
        kind: 'unknown-source-id',
        side: error.side,
        id: error.id,
        availableIds: [...error.availableIds],
      });
    case 'anonymous-view-execution':
      return new BadGatewayException({
        kind: 'anonymous-view-execution',
        side: error.side,
        message: error.message,
      });
    case 'anonymous-select-execution':
      return new BadGatewayException({
        kind: 'anonymous-select-execution',
        side: error.side,
        message: error.message,
      });
    case 'source':
      return new InternalServerErrorException({
        kind: 'source',
        side: error.side,
        source: { ...error.source },
      });
    case 'reference-target':
      return new InternalServerErrorException({ kind: 'reference-target' });
    case 'glob-load':
      return new InternalServerErrorException({
        kind: 'glob-load',
        glob: [...error.glob],
        file: error.file,
        message: error.message,
      });
    case 'query-execution':
      return new BadGatewayException({
        kind: 'query-execution',
        query: error.query,
        message: error.message,
      });
    case 'endpoint-fetch':
      return new BadGatewayException({
        kind: 'endpoint-fetch',
        endpoint: error.endpoint,
        message: error.message,
      });
    case 'view-validation':
      return new BadRequestException({
        kind: 'view-validation',
        viewId: error.viewId,
        message: error.message,
      });
    case 'view-reference':
      return new BadRequestException({
        kind: 'view-reference',
        viewId: error.viewId,
        ref: error.ref,
        reason: error.reason,
        message: error.message,
      });
    case 'cache-io':
      return new InternalServerErrorException({
        kind: 'cache-io',
        cachePath: error.cachePath,
        message: error.message,
      });
    case 'legacy-message':
      return new InternalServerErrorException({
        kind: 'legacy-message',
        message: error.message,
      });
  }
}
