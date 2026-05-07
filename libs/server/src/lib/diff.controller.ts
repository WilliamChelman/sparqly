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
import { DiffService, type DiffResponse } from './diff.service';
import { SPARQL_DIFF_SERVICE } from './tokens';

const DIFF_REQUEST_SCHEMA = z
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
    const parsed = DIFF_REQUEST_SCHEMA.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        kind: 'validation-error',
        issues: parsed.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
    }
    const result: DiffResponse = await this.service.runDiff(parsed.data);
    res
      .status(HttpStatus.OK)
      .setHeader('Content-Type', 'application/json')
      .send(JSON.stringify(result));
  }
}
