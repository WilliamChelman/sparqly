import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ResultAsync } from 'neverthrow';
import {
  QueryEngine,
  resolveSourceResult,
  selectTargetResult,
  type ExecuteResult,
  type ParsedSource,
  type QuerySources,
  type SourceError,
  type SparqlFormat,
  type TargetError,
} from 'core';
import {
  EngineMap,
  SPARQL_CONFIG,
  SPARQL_ENGINE_MAP,
  SPARQL_RESOLUTION_REGISTRY,
  SPARQL_SERVED_REGISTRY,
  type SparqlServerConfig,
} from '../bootstrap';
import { sourceErrorToStatus, targetErrorToStatus } from '../shared';

const SPARQL_QUERY_CT = 'application/sparql-query';
const FORM_CT = 'application/x-www-form-urlencoded';

interface ResLike {
  status(code: number): ResLike;
  setHeader(name: string, value: string): ResLike;
  send(body: string): ResLike;
}

@Controller('sparql')
export class RegistrySparqlController {
  constructor(
    @Inject(SPARQL_ENGINE_MAP) private readonly engineMap: EngineMap,
    @Inject(SPARQL_CONFIG) private readonly config: SparqlServerConfig,
    @Inject(SPARQL_SERVED_REGISTRY)
    private readonly servedRegistry: ReadonlyArray<ParsedSource>,
    @Inject(SPARQL_RESOLUTION_REGISTRY)
    private readonly resolutionRegistry: ReadonlyArray<ParsedSource>,
  ) {}

  /** Unparameterized alias — forwards to the default source. */
  @Get()
  async getDefault(
    @Query('query') query: string | undefined,
    @Headers('accept') accept: string | undefined,
    @Res() res: ResLike,
  ): Promise<void> {
    this.assertQuery(query);
    await this.respond(undefined, query, accept, res);
  }

  @Post()
  async postDefault(
    @Headers('content-type') contentType: string | undefined,
    @Headers('accept') accept: string | undefined,
    @Body() body: unknown,
    @Res() res: ResLike,
  ): Promise<void> {
    const query = this.extractPostQuery(contentType, body);
    await this.respond(undefined, query, accept, res);
  }

  @Get('*id')
  async get(
    @Param('id') id: string | string[],
    @Query('query') query: string | undefined,
    @Headers('accept') accept: string | undefined,
    @Res() res: ResLike,
  ): Promise<void> {
    this.assertQuery(query);
    await this.respond(toRef(id), query, accept, res);
  }

  @Post('*id')
  async post(
    @Param('id') id: string | string[],
    @Headers('content-type') contentType: string | undefined,
    @Headers('accept') accept: string | undefined,
    @Body() body: unknown,
    @Res() res: ResLike,
  ): Promise<void> {
    const query = this.extractPostQuery(contentType, body);
    await this.respond(toRef(id), query, accept, res);
  }

  private assertQuery(query: string | undefined): asserts query is string {
    if (!query || query.trim() === '') {
      throw new BadRequestException('Missing required query parameter');
    }
  }

  private extractPostQuery(
    contentType: string | undefined,
    body: unknown,
  ): string {
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
    this.assertQuery(query);
    return query;
  }

  private async respond(
    ref: string | undefined,
    query: string,
    accept: string | undefined,
    res: ResLike,
  ): Promise<void> {
    const format = pickFormat(accept);
    const result = await selectTargetResult(
      this.servedRegistry,
      ref,
    ).asyncAndThen((target: ParsedSource) =>
      this.executeAgainstTarget(target, query, format),
    );
    result.match(
      (ok: ExecuteResult) => {
        res
          .status(HttpStatus.OK)
          .setHeader('Content-Type', ok.contentType)
          .send(ok.body);
      },
      (error: SourceError | TargetError) => {
        throw mapError(error);
      },
    );
  }

  private executeAgainstTarget(
    target: ParsedSource,
    query: string,
    format: SparqlFormat | undefined,
  ): ResultAsync<ExecuteResult, SourceError | TargetError> {
    const id = target.id as string;
    if (this.isAdHocPin(target)) {
      return this.executeAdHocPinned(target, query, format);
    }
    return this.engineMap
      .get(id)
      .executeResult(query, { format, mutable: this.config.mutable });
  }

  /**
   * `true` when the target carries a `gitRef`/`fromGitRef` pin that the
   * pre-built engine for its id was not constructed with — i.e. an incoming
   * `@id:ref` (or view target with a propagated `fromGitRef`) that asks for a
   * different variant than the boot-time-registered one. The route resolves
   * such requests ad-hoc (ADR-0029, issue #278).
   */
  private isAdHocPin(target: ParsedSource): boolean {
    const registered = this.engineMap.getSource(target.id as string);
    if (!registered) return false;
    return (
      pinOf(target).gitRef !== pinOf(registered).gitRef ||
      pinOf(target).fromGitRef !== pinOf(registered).fromGitRef
    );
  }

  private executeAdHocPinned(
    target: ParsedSource,
    query: string,
    format: SparqlFormat | undefined,
  ): ResultAsync<ExecuteResult, SourceError | TargetError> {
    return resolveSourceResult(target, {
      registry: this.resolutionRegistry,
    }).andThen<ExecuteResult, SourceError | TargetError>((sources: QuerySources) => {
      if (sources.mode === 'pass-through') {
        return new QueryEngine(sources.endpoint, {
          id: target.id as string,
          mode: 'pass-through',
        }).executeResult(query, { format, mutable: this.config.mutable });
      }
      return new QueryEngine(sources.store, {
        id: target.id as string,
        mode: 'materialized',
      }).executeResult(query, { format, mutable: this.config.mutable });
    });
  }
}

function mapError(error: SourceError | TargetError): HttpException {
  if (isTargetError(error)) {
    return statusToHttpException(targetErrorToStatus(error), cloneError(error));
  }
  return statusToHttpException(sourceErrorToStatus(error), cloneError(error));
}

function isTargetError(
  error: SourceError | TargetError,
): error is TargetError {
  switch (error.kind) {
    case 'ref-as-target':
    case 'empty-registry':
    case 'no-default-multi':
    case 'unknown-ref':
      return true;
    default:
      return false;
  }
}

function cloneError(error: SourceError | TargetError): object {
  return JSON.parse(JSON.stringify(error)) as object;
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

function joinId(id: string | string[]): string {
  return Array.isArray(id) ? id.join('/') : id;
}

function toRef(id: string | string[]): string {
  const joined = joinId(id);
  return joined.startsWith('@') ? joined : `@${joined}`;
}

function pinOf(source: ParsedSource): {
  gitRef: string | undefined;
  fromGitRef: string | undefined;
} {
  const s = source as {
    gitRef?: string;
    fromGitRef?: string;
  };
  return { gitRef: s.gitRef, fromGitRef: s.fromGitRef };
}

function pickFormat(accept: string | undefined): SparqlFormat | undefined {
  if (!accept) return undefined;
  const lower = accept.toLowerCase();
  if (lower.includes('application/sparql-results+json')) return 'json';
  if (lower.includes('text/turtle')) return 'turtle';
  if (lower.includes('application/json')) return 'json';
  return undefined;
}
