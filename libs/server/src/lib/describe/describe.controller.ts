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
import { DescribeService } from './describe.service';
import { mapDescribeHttpError } from './describe-http-errors';
import { SPARQL_DESCRIBE_SERVICE } from '../bootstrap';

const PATH_STEP_SCHEMA = z
  .object({ predicate: z.string().min(1), inverse: z.boolean() })
  .strict();

const DESCRIBE_REQUEST_SCHEMA = z
  .object({
    iri: z.string().min(1),
    source: z.string().min(1).optional(),
    withProvenance: z.boolean().optional(),
    perSourceLimit: z.number().int().positive().optional(),
    fromSourcePredicate: z.string().min(1).optional(),
    expandedPaths: z.array(z.array(PATH_STEP_SCHEMA)).optional(),
  })
  .strict();

interface ResLike {
  status(code: number): ResLike;
  setHeader(name: string, value: string): ResLike;
  send(body: string): ResLike;
}

@Controller('describe')
export class DescribeController {
  constructor(
    @Inject(SPARQL_DESCRIBE_SERVICE) private readonly service: DescribeService,
  ) {}

  @Post()
  async post(@Body() body: unknown, @Res() res: ResLike): Promise<void> {
    const parsed = DESCRIBE_REQUEST_SCHEMA.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        kind: 'validation-error',
        issues: parsed.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
    }
    const result = await this.service.runDescribe(parsed.data);
    if (result.isErr()) {
      throw mapDescribeHttpError(result.error);
    }
    res
      .status(HttpStatus.OK)
      .setHeader('Content-Type', 'application/json')
      .send(JSON.stringify(result.value));
  }
}
