import {
  BadRequestException,
  Body,
  Controller,
  HttpStatus,
  Inject,
  Post,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import { ok, err, type Result } from 'neverthrow';
import {
  safeParseResult,
  type DiffError,
  type SafeParseIssue,
} from 'core';
import { DiffService, type DiffResponse } from './diff.service';
import {
  mapDiffHttpError,
  type TransportDiffError,
} from './diff-http-errors';
import { SPARQL_DIFF_SERVICE } from '../bootstrap';

interface DiffRequestBody {
  left: string;
  right: string;
  leftQuery?: string;
  rightQuery?: string;
  skipAutoSourceAnnotation?: boolean;
}

const DIFF_REQUEST_SCHEMA: z.ZodType<DiffRequestBody> = z
  .object({
    left: z.string().min(1),
    right: z.string().min(1),
    leftQuery: z.string().optional(),
    rightQuery: z.string().optional(),
    skipAutoSourceAnnotation: z.boolean().optional(),
  })
  .strict();

interface ResLike {
  status(code: number): ResLike;
  setHeader(name: string, value: string): ResLike;
  send(body: string): ResLike;
}

@Controller('diff')
export class DiffController {
  constructor(
    @Inject(SPARQL_DIFF_SERVICE) private readonly service: DiffService,
  ) {}

  @Post()
  async post(@Body() body: unknown, @Res() res: ResLike): Promise<void> {
    const parsed = safeParseResult<DiffRequestBody>(DIFF_REQUEST_SCHEMA, body);
    if (parsed.isErr()) {
      throw new BadRequestException({
        kind: 'zod-validation',
        issues: parsed.error.issues.map((i: SafeParseIssue) => ({
          path: i.path,
          message: i.message,
        })),
      });
    }
    const response = await this.service.runDiff(parsed.value);
    classifyDiffResponse(response).match(
      (payload: DiffResponse) => {
        res
          .status(HttpStatus.OK)
          .setHeader('Content-Type', 'application/json')
          .send(JSON.stringify(payload));
      },
      (transport: TransportDiffError) => {
        throw mapDiffHttpError(transport);
      },
    );
  }
}

function classifyDiffResponse(
  response: DiffResponse,
): Result<DiffResponse, TransportDiffError> {
  if (response.kind !== 'error') return ok(response);
  for (const slot of ['left', 'right', 'top'] as const) {
    const e = response.errors[slot];
    if (e !== undefined && isTransportVariant(e)) {
      return err(e);
    }
  }
  return ok(response);
}

function isTransportVariant(e: DiffError): e is TransportDiffError {
  return (
    e.kind === 'target' ||
    e.kind === 'anonymous-view-execution' ||
    e.kind === 'anonymous-select-execution' ||
    e.kind === 'source'
  );
}
