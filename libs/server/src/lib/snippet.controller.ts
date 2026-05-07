import { fileURLToPath } from 'node:url';
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpStatus,
  Inject,
  Query,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import { readSourceSnippet, type SnippetReadResult } from 'core';
import { SnippetAllowList } from './snippet-allow-list';
import { SPARQL_SNIPPET_ALLOW_LIST } from './tokens';

const SNIPPET_QUERY_SCHEMA = z
  .object({
    file: z.string().min(1),
    line: z.coerce.number().int().positive(),
    snippetContext: z.coerce.number().int().nonnegative(),
  })
  .strict();

interface ResLike {
  status(code: number): ResLike;
  setHeader(name: string, value: string): ResLike;
  send(body: string): ResLike;
}

@Controller('source-snippet')
export class SnippetController {
  constructor(
    @Inject(SPARQL_SNIPPET_ALLOW_LIST)
    private readonly allowList: SnippetAllowList,
  ) {}

  @Get()
  async get(
    @Query() rawQuery: Record<string, unknown>,
    @Res() res: ResLike,
  ): Promise<void> {
    const parsed = SNIPPET_QUERY_SCHEMA.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({
        kind: 'validation-error',
        issues: parsed.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
    }

    let absPath: string;
    try {
      absPath = fileURLToPath(parsed.data.file);
    } catch {
      throw new BadRequestException(
        '`file` must be a file:// URI (got a different scheme)',
      );
    }

    if (!this.allowList.has(absPath)) {
      throw new ForbiddenException({
        kind: 'not-in-allow-list',
        message:
          'requested path is not in the snippet allow-list (source-snippet only serves files the loader actually opened)',
      });
    }

    const result: SnippetReadResult = await readSourceSnippet(
      absPath,
      parsed.data.line,
      parsed.data.snippetContext,
    );

    const status = is404Reason(result)
      ? HttpStatus.NOT_FOUND
      : HttpStatus.OK;
    res
      .status(status)
      .setHeader('Content-Type', 'application/json')
      .send(JSON.stringify(result));
  }
}

function is404Reason(result: SnippetReadResult): boolean {
  return (
    result.kind === 'unavailable' &&
    (result.reason === 'missing' || result.reason === 'not-a-file')
  );
}
