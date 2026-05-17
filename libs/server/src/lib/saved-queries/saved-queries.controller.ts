import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Put,
  Res,
} from '@nestjs/common';
import {
  lintEntry,
  SAVED_QUERY_SLUG_REGEX,
  type SavedQueryEntry,
  type SavedQueryEntrySummary,
} from 'core';
import { ParameterDeclarationSchema } from 'common';
import type { ParameterDeclaration } from 'common';
import {
  SPARQL_SAVED_QUERIES_CONFIG,
  SPARQL_SAVED_QUERIES_SERVICE,
  type SavedQueriesServerConfig,
} from '../bootstrap';
import { SavedQueriesService } from './saved-queries.service';

// Minimal subset of the express Response surface this controller uses. Avoids
// dragging an `import type { Response } from 'express'` into the server bundle
// graph just to set a header and a status code.
interface ResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): unknown;
}

interface PutBody {
  slug?: string;
  description?: string;
  body?: string;
  parameters?: unknown;
}

@Controller('saved-queries')
export class SavedQueriesController {
  constructor(
    @Inject(SPARQL_SAVED_QUERIES_SERVICE)
    private readonly service: SavedQueriesService,
    @Inject(SPARQL_SAVED_QUERIES_CONFIG)
    private readonly config: SavedQueriesServerConfig,
  ) {}

  @Get()
  async list(): Promise<ReadonlyArray<SavedQueryEntrySummary>> {
    return this.service.list();
  }

  @Get(':slug')
  async getOne(
    @Param('slug') slug: string,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<SavedQueryEntry> {
    this.assertSlug(slug);
    const found = await this.service.get(slug);
    if (!found) throw new NotFoundException({ error: 'unknown-slug', slug });
    res.setHeader('ETag', quoteEtag(found.etag));
    return found.entry;
  }

  @Put(':slug')
  @Header('Cache-Control', 'no-store')
  async upsert(
    @Param('slug') slug: string,
    @Headers('if-match') ifMatchHeader: string | undefined,
    @Body() body: PutBody,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<SavedQueryEntry> {
    this.assertWritable();
    this.assertSlug(slug);
    if (body.slug !== undefined && body.slug !== slug) {
      throw new HttpException(
        { error: 'slug-mismatch', urlSlug: slug, bodySlug: body.slug },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (typeof body.body !== 'string' || body.body.length === 0) {
      throw new HttpException(
        { error: 'missing-body' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const parameters = this.parseParameters(body.parameters);
    const candidate: SavedQueryEntry = {
      slug,
      body: body.body,
    };
    if (body.description !== undefined) candidate.description = body.description;
    if (parameters !== undefined) candidate.parameters = parameters;
    const linted = lintEntry(candidate);
    if (linted.isErr()) {
      throw new HttpException(
        { error: 'lint-failed', slug, lint: linted.error },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const ifMatch = unquoteEtag(ifMatchHeader);
    const result = await this.service.put(
      slug,
      { description: body.description, body: body.body, parameters },
      ifMatch,
    );
    if (result.kind === 'collision') {
      throw new ConflictException({ error: 'slug-exists', slug });
    }
    if (result.kind === 'stale') {
      throw new HttpException(
        { error: 'etag-mismatch', slug },
        HttpStatus.PRECONDITION_FAILED,
      );
    }
    res.setHeader('ETag', quoteEtag(result.etag));
    res.status(result.kind === 'created' ? HttpStatus.CREATED : HttpStatus.OK);
    return candidate;
  }

  private parseParameters(
    raw: unknown,
  ): ParameterDeclaration[] | undefined {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw)) {
      throw new HttpException(
        { error: 'invalid-parameters' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const out: ParameterDeclaration[] = [];
    for (const item of raw) {
      const parsed = ParameterDeclarationSchema.safeParse(item);
      if (!parsed.success) {
        throw new HttpException(
          {
            error: 'invalid-parameters',
            issues: parsed.error.issues,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      out.push(parsed.data);
    }
    return out;
  }

  @Delete(':slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('slug') slug: string,
    @Headers('if-match') ifMatchHeader: string | undefined,
  ): Promise<void> {
    this.assertWritable();
    this.assertSlug(slug);
    const ifMatch = unquoteEtag(ifMatchHeader);
    const result = await this.service.delete(slug, ifMatch);
    if (result === 'precondition-required') {
      throw new HttpException(
        { error: 'precondition-required' },
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }
    if (result === 'missing') {
      throw new NotFoundException({ error: 'unknown-slug', slug });
    }
    if (result === 'stale') {
      throw new HttpException(
        { error: 'etag-mismatch', slug },
        HttpStatus.PRECONDITION_FAILED,
      );
    }
  }

  private assertWritable(): void {
    if (this.config.writable) return;
    throw new HttpException(
      { error: 'read-only' },
      HttpStatus.METHOD_NOT_ALLOWED,
    );
  }

  private assertSlug(slug: string): void {
    if (!SAVED_QUERY_SLUG_REGEX.test(slug)) {
      throw new HttpException(
        { error: 'invalid-slug', slug },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}

function quoteEtag(value: string): string {
  return `"${value}"`;
}

function unquoteEtag(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const trimmed = header.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
