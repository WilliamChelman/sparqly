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
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { type Result } from 'neverthrow';
import {
  selectTargetResult,
  type ExecuteResult,
  type ParsedSource,
  type SourceError,
  type SparqlFormat,
  type TargetError,
} from 'core';
import {
  EngineMap,
  isIndexingError,
  SPARQL_CONFIG,
  SPARQL_ENGINE_MAP,
  SPARQL_SERVED_REGISTRY,
  type IndexingError,
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

/** The slice of the raw request the controller needs to detect a client
 * disconnect (ADR-0050). `close`/`aborted` fire when the HTTP connection drops
 * before the response completes — the trigger to cancel the in-flight query. */
interface ReqLike {
  on(event: string, listener: () => void): void;
  off(event: string, listener: () => void): void;
}

@Controller('sparql')
export class RegistrySparqlController {
  constructor(
    @Inject(SPARQL_ENGINE_MAP) private readonly engineMap: EngineMap,
    @Inject(SPARQL_CONFIG) private readonly config: SparqlServerConfig,
    @Inject(SPARQL_SERVED_REGISTRY)
    private readonly servedRegistry: ReadonlyArray<ParsedSource>,
  ) {}

  /** Unparameterized alias — forwards to the default source. */
  @Get()
  async getDefault(
    @Query('query') query: string | undefined,
    @Headers('accept') accept: string | undefined,
    @Res() res: ResLike,
    @Req() req: ReqLike,
  ): Promise<void> {
    this.assertQuery(query);
    await this.respond(undefined, query, accept, res, req);
  }

  @Post()
  async postDefault(
    @Headers('content-type') contentType: string | undefined,
    @Headers('accept') accept: string | undefined,
    @Body() body: unknown,
    @Res() res: ResLike,
    @Req() req: ReqLike,
  ): Promise<void> {
    const query = this.extractPostQuery(contentType, body);
    await this.respond(undefined, query, accept, res, req);
  }

  @Get('*id')
  async get(
    @Param('id') id: string | string[],
    @Query('query') query: string | undefined,
    @Headers('accept') accept: string | undefined,
    @Res() res: ResLike,
    @Req() req: ReqLike,
  ): Promise<void> {
    this.assertQuery(query);
    await this.respond(toRef(id), query, accept, res, req);
  }

  @Post('*id')
  async post(
    @Param('id') id: string | string[],
    @Headers('content-type') contentType: string | undefined,
    @Headers('accept') accept: string | undefined,
    @Body() body: unknown,
    @Res() res: ResLike,
    @Req() req: ReqLike,
  ): Promise<void> {
    const query = this.extractPostQuery(contentType, body);
    await this.respond(toRef(id), query, accept, res, req);
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
    req: ReqLike,
  ): Promise<void> {
    const format = pickFormat(accept);
    const selected = selectTargetResult(this.servedRegistry, ref);
    if (selected.isErr()) {
      throw mapError(selected.error);
    }
    // A client disconnect cancels the in-flight query (ADR-0050) so it can't tie
    // up a bounded worker. Detached on settle so a normal close fires no stray
    // cancel.
    const abort = new AbortController();
    const onDisconnect = (): void => abort.abort();
    req.on('close', onDisconnect);
    req.on('aborted', onDisconnect);
    let result: Result<ExecuteResult, SourceError | TargetError | IndexingError>;
    try {
      result = await this.executeAgainstTarget(
        selected.value,
        query,
        format,
        abort.signal,
      );
    } finally {
      req.off('close', onDisconnect);
      req.off('aborted', onDisconnect);
    }
    result.match(
      (ok: ExecuteResult) => {
        res
          .status(HttpStatus.OK)
          .setHeader('Content-Type', ok.contentType)
          .send(ok.body);
      },
      (error: SourceError | TargetError | IndexingError) => {
        throw mapError(error);
      },
    );
  }

  private async executeAgainstTarget(
    target: ParsedSource,
    query: string,
    format: SparqlFormat | undefined,
    signal: AbortSignal,
  ): Promise<Result<ExecuteResult, SourceError | TargetError | IndexingError>> {
    if (this.isAdHocPin(target)) {
      // ADR-0050 / #390: an ad-hoc pin the registry never pre-built. EngineMap
      // routes an in-memory pinned glob through the worker pool (keyed by
      // resolved SHA) so it runs off the main loop, and falls back to a
      // main-thread build for pass-through/disk-backed/no-worker.
      return this.engineMap
        .ensureAdHoc(target)
        .andThen<ExecuteResult, SourceError | TargetError | IndexingError>(
          (engine) =>
            engine.executeResult(query, {
              format,
              mutable: this.config.mutable,
              signal,
            }),
        );
    }
    // ensure() shares the in-flight promise so concurrent first-touches load
    // exactly once. Failures surface as typed SourceError so mapError can route
    // 4xx vs 5xx instead of collapsing everything to 500.
    return this.engineMap
      .ensure(target.id as string)
      .andThen<ExecuteResult, SourceError | TargetError | IndexingError>(
        (engine) =>
          engine.executeResult(query, {
            format,
            mutable: this.config.mutable,
            signal,
          }),
      );
  }

  // `true` when the target's pin doesn't match the pre-built engine — the
  // route then resolves it ad-hoc instead of using the registered variant.
  private isAdHocPin(target: ParsedSource): boolean {
    const registered = this.engineMap.getSource(target.id as string);
    if (!registered) return false;
    return (
      pinOf(target).gitRef !== pinOf(registered).gitRef ||
      pinOf(target).fromGitRef !== pinOf(registered).fromGitRef
    );
  }
}

function mapError(
  error: SourceError | TargetError | IndexingError,
): HttpException {
  if (isIndexingError(error)) {
    // Index is still building — transient 503 telling the client to retry.
    return new ServiceUnavailableException(cloneError(error));
  }
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

function cloneError(
  error: SourceError | TargetError | IndexingError,
): object {
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
