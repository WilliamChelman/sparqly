import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { SparqlFormat } from 'core';
import { EngineMap } from './engine-map';
import {
  SPARQL_CONFIG,
  SPARQL_ENGINE_MAP,
  type SparqlServerConfig,
} from './tokens';

const SPARQL_QUERY_CT = 'application/sparql-query';
const FORM_CT = 'application/x-www-form-urlencoded';

interface ResLike {
  status(code: number): ResLike;
  setHeader(name: string, value: string): ResLike;
  send(body: string): ResLike;
}

@Controller('sparql/:id')
export class RegistrySparqlController {
  constructor(
    @Inject(SPARQL_ENGINE_MAP) private readonly engineMap: EngineMap,
    @Inject(SPARQL_CONFIG) private readonly config: SparqlServerConfig,
  ) {}

  @Get()
  async get(
    @Param('id') id: string,
    @Query('query') query: string | undefined,
    @Headers('accept') accept: string | undefined,
    @Res() res: ResLike,
  ): Promise<void> {
    this.assertKnownId(id);
    if (!query || query.trim() === '') {
      throw new BadRequestException('Missing required query parameter');
    }
    await this.respond(id, query, accept, res);
  }

  @Post()
  async post(
    @Param('id') id: string,
    @Headers('content-type') contentType: string | undefined,
    @Headers('accept') accept: string | undefined,
    @Body() body: unknown,
    @Res() res: ResLike,
  ): Promise<void> {
    this.assertKnownId(id);
    const ct = (contentType ?? '').toLowerCase();
    let query: string | undefined;
    if (ct.includes(SPARQL_QUERY_CT)) {
      query = typeof body === 'string' ? body : undefined;
    } else if (ct.includes(FORM_CT)) {
      if (body && typeof body === 'object' && 'query' in body) {
        const q = (body as Record<string, unknown>)['query'];
        query = typeof q === 'string' ? q : undefined;
      }
    } else {
      throw new HttpException(
        `Unsupported Content-Type. Expected '${SPARQL_QUERY_CT}' or '${FORM_CT}'.`,
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    if (!query || query.trim() === '') {
      throw new BadRequestException('Missing required query parameter');
    }
    await this.respond(id, query, accept, res);
  }

  private assertKnownId(id: string): void {
    if (!this.engineMap.allIds().includes(id)) {
      throw new NotFoundException(`No source with @id "${id}"`);
    }
  }

  private async respond(
    id: string,
    query: string,
    accept: string | undefined,
    res: ResLike,
  ): Promise<void> {
    const format = pickFormat(accept);
    const engine = this.engineMap.get(id);
    try {
      const result = await engine.execute(query, {
        format,
        mutable: this.config.mutable,
      });
      res
        .status(HttpStatus.OK)
        .setHeader('Content-Type', result.contentType)
        .send(result.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(message);
    }
  }
}

function pickFormat(accept: string | undefined): SparqlFormat | undefined {
  if (!accept) return undefined;
  const lower = accept.toLowerCase();
  if (lower.includes('application/sparql-results+json')) return 'json';
  if (lower.includes('text/turtle')) return 'turtle';
  if (lower.includes('application/json')) return 'json';
  return undefined;
}
