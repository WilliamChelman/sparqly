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
import {
  readSourceSnippets,
  type FocalRange,
  type SnippetReadResult,
} from 'core';
import { SnippetAllowList } from './snippet-allow-list';
import { SPARQL_SNIPPET_ALLOW_LIST } from '../bootstrap';

const RANGE_SPEC = /^([1-9][0-9]*)(?:-([1-9][0-9]*))?$/;

const RANGES = z
  .union([z.string(), z.array(z.string())])
  .transform((raw, ctx): FocalRange[] => {
    const specs = Array.isArray(raw) ? raw : [raw];
    if (specs.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'at least one `range` is required' });
      return z.NEVER;
    }
    const ranges: FocalRange[] = [];
    for (const spec of specs) {
      const m = RANGE_SPEC.exec(spec);
      if (m === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `\`range\` must be "<line>" or "<startLine>-<endLine>" (got "${spec}")`,
        });
        return z.NEVER;
      }
      const focalStart = Number(m[1]);
      const focalEnd = m[2] === undefined ? focalStart : Number(m[2]);
      if (focalEnd < focalStart) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `\`range\` end must be >= start (got "${spec}")`,
        });
        return z.NEVER;
      }
      ranges.push({ focalStart, focalEnd });
    }
    return ranges;
  });

const SNIPPET_QUERY_SCHEMA = z
  .object({
    file: z.string().min(1),
    snippetContext: z.coerce.number().int().nonnegative(),
    range: RANGES,
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

    const snippets: SnippetReadResult[] = await readSourceSnippets(
      absPath,
      parsed.data.range,
      parsed.data.snippetContext,
    );

    res
      .status(HttpStatus.OK)
      .setHeader('Content-Type', 'application/json')
      .send(JSON.stringify({ snippets }));
  }
}
