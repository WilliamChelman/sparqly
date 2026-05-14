import {
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import type { TargetError } from 'core';
import { targetErrorToStatus } from '../shared';
import type { SnippetError } from './errors';

/**
 * Per-ADR-0024 mapper from `SnippetError` to `HttpException`. The snippet
 * endpoint surfaces failures as HTTP statuses (not the diff in-band envelope)
 * because each request covers exactly one file: there is no "partial success"
 * to preserve once the file is unreadable or the request is structurally
 * invalid.
 */
export function mapSnippetHttpError(error: SnippetError): HttpException {
  switch (error.kind) {
    case 'target': {
      const status = targetErrorToStatus(error.target);
      const body = {
        kind: 'target' as const,
        target: cloneTargetError(error.target),
      };
      return statusToHttpException(status, body);
    }
    case 'file-read':
      return new InternalServerErrorException({
        kind: 'file-read',
        file: error.file,
        reason: error.reason,
      });
    case 'range-malformed':
      return new BadRequestException({
        kind: 'range-malformed',
        spec: error.spec,
        reason: error.reason,
      });
    case 'range-out-of-bounds':
      return new BadRequestException({
        kind: 'range-out-of-bounds',
        spec: error.spec,
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
    default:
      return new InternalServerErrorException(body);
  }
}
