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
import { SnippetAllowList } from './snippet-allow-list';
import { mapSnippetHttpError } from './snippet-http-errors';
import { SnippetService } from './snippet.service';
import { SPARQL_SNIPPET_ALLOW_LIST } from '../bootstrap';

const SNIPPET_QUERY_SCHEMA = z
  .object({
    file: z.string().min(1),
    snippetContext: z.coerce.number().int().nonnegative(),
    range: z
      .union([z.string(), z.array(z.string())])
      .transform((raw, ctx): string[] => {
        const specs = Array.isArray(raw) ? raw : [raw];
        if (specs.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'at least one `range` is required',
          });
          return z.NEVER;
        }
        return specs;
      }),
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
    private readonly service: SnippetService,
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

    const result = await this.service.readSnippets({
      file: absPath,
      rangeSpecs: parsed.data.range,
      context: parsed.data.snippetContext,
    });

    result.match(
      ({ snippets }) => {
        res
          .status(HttpStatus.OK)
          .setHeader('Content-Type', 'application/json')
          .send(JSON.stringify({ snippets }));
      },
      (error) => {
        throw mapSnippetHttpError(error);
      },
    );
  }
}
