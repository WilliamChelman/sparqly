import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import type { DiffError, SourceError, TargetError } from 'core';
import { targetErrorToStatus } from '../shared';

/**
 * DiffError variants that the diff controller forwards to the mapper instead
 * of returning through the in-band envelope.
 */
export type TransportDiffError = Extract<
  DiffError,
  {
    kind:
      | 'target'
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
    case 'target': {
      const status = targetErrorToStatus(error.target);
      const body = {
        kind: 'target' as const,
        side: error.side,
        target: cloneTargetError(error.target),
      };
      return statusToHttpException(status, body);
    }
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
    case 'transform-parse':
      return new BadRequestException({
        kind: 'transform-parse',
        transformKey: error.transformKey,
        message: error.message,
      });
    case 'git-pin':
      return new BadRequestException({
        kind: 'git-pin',
        reason: error.reason,
        message: error.message,
      });
  }
}

function cloneTargetError(error: TargetError): TargetError {
  switch (error.kind) {
    case 'ref-as-target':
    case 'empty-registry':
      return { kind: error.kind };
    case 'no-default-multi':
      return { kind: 'no-default-multi', availableIds: [...error.availableIds] };
    case 'unknown-ref':
      return {
        kind: 'unknown-ref',
        ref: error.ref,
        availableIds: [...error.availableIds],
      };
  }
}

function statusToHttpException(
  status: HttpStatus,
  body: object,
): HttpException {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return new BadRequestException(body);
    case HttpStatus.BAD_GATEWAY:
      return new BadGatewayException(body);
    default:
      return new InternalServerErrorException(body);
  }
}
