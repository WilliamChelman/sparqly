import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Sse,
} from '@nestjs/common';
import type { ParsedSource } from 'core';
import { interval, merge, type Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  SPARQL_ENGINE_MAP,
  SPARQL_SERVED_REGISTRY,
  SPARQL_SOURCE_STATE_BROKER,
  SPARQL_SOURCES_ADMIN_CONFIG,
  type EngineMapProvider,
  type SourcesAdminServerConfig,
} from '../bootstrap/tokens';
import { probeEndpoint, type ProbeResult } from './endpoint-probe';
import { projectSourceRow, type SourceRow } from './source-row-projector';
import type {
  SourcesSseEnvelope,
  SourceStateBroker,
} from './source-state-broker';

export interface SourceAdminActionResponse {
  id: string;
  state: string;
}

@Controller('sources')
export class SourcesController {
  constructor(
    @Inject(SPARQL_SERVED_REGISTRY)
    private readonly servedRegistry: ReadonlyArray<ParsedSource>,
    @Inject(SPARQL_ENGINE_MAP)
    private readonly engineMap: EngineMapProvider,
    @Inject(SPARQL_SOURCE_STATE_BROKER)
    private readonly broker: SourceStateBroker,
    @Inject(SPARQL_SOURCES_ADMIN_CONFIG)
    private readonly adminConfig: SourcesAdminServerConfig,
  ) {}

  @Get()
  async snapshot(): Promise<SourceRow[]> {
    const rows: SourceRow[] = [];
    for (const source of this.servedRegistry) {
      // Reference sources are never served — they exist only as `from:` targets.
      if (source.kind === 'reference') continue;
      if (source.id === undefined) continue;
      const runtime = await this.engineMap.readState(source.id);
      rows.push(projectSourceRow(source, runtime));
    }
    return rows;
  }

  @Post(':id/load')
  @HttpCode(HttpStatus.ACCEPTED)
  async load(@Param('id') id: string): Promise<SourceAdminActionResponse> {
    this.assertAdminAllowed();
    this.assertKnownId(id);
    // A failing load clears the memoization slot so the next click can retry;
    // the SSE stream surfaces the `load-failure` transition separately.
    await this.engineMap.ensure(id);
    return this.respondWithState(id);
  }

  @Post(':id/reload')
  @HttpCode(HttpStatus.ACCEPTED)
  async reload(@Param('id') id: string): Promise<SourceAdminActionResponse> {
    this.assertAdminAllowed();
    this.assertKnownId(id);
    await this.engineMap.reload(id);
    return this.respondWithState(id);
  }

  @Post(':id/unload')
  @HttpCode(HttpStatus.ACCEPTED)
  async unload(@Param('id') id: string): Promise<SourceAdminActionResponse> {
    this.assertAdminAllowed();
    this.assertKnownId(id);
    await this.engineMap.unload(id);
    return this.respondWithState(id);
  }

  @Post(':id/index-build')
  @HttpCode(HttpStatus.ACCEPTED)
  async indexBuild(
    @Param('id') id: string,
  ): Promise<SourceAdminActionResponse> {
    this.assertAdminAllowed();
    this.assertKnownId(id);
    try {
      this.engineMap.requestBuild(id);
    } catch (error) {
      // Wrong verb for the entry's kind — not a server error.
      throw new BadRequestException({
        error: 'not-disk-backed',
        id,
        message: (error as Error).message,
      });
    }
    return this.respondWithState(id);
  }

  @Delete(':id/index-build')
  @HttpCode(HttpStatus.ACCEPTED)
  async indexBuildCancel(
    @Param('id') id: string,
  ): Promise<SourceAdminActionResponse> {
    this.assertAdminAllowed();
    this.assertKnownId(id);
    this.engineMap.cancelBuild(id);
    return this.respondWithState(id);
  }

  // Never memoized — each click re-asks so the chip never lies about a stale check.
  @Post(':id/test-connection')
  @HttpCode(HttpStatus.OK)
  async testConnection(@Param('id') id: string): Promise<ProbeResult> {
    this.assertAdminAllowed();
    const engine = this.engineMap.getEndpointEngine(id);
    if (engine === undefined) {
      throw new NotFoundException({ error: 'unknown-endpoint', id });
    }
    return probeEndpoint(engine);
  }

  private assertAdminAllowed(): void {
    if (this.adminConfig.allowAdminActions) return;
    throw new ForbiddenException({ error: 'admin-actions-disabled' });
  }

  private assertKnownId(id: string): void {
    for (const source of this.servedRegistry) {
      if (source.kind === 'reference') continue;
      if (source.id === id) return;
    }
    throw new NotFoundException({ error: 'unknown-source', id });
  }

  private async respondWithState(
    id: string,
  ): Promise<SourceAdminActionResponse> {
    const runtime = await this.engineMap.readState(id);
    return {
      id,
      state: runtime.mode === 'endpoint' ? 'endpoint' : runtime.state,
    };
  }

  @Sse('stream')
  stream(
    @Headers('last-event-id') lastEventIdHeader?: string,
  ): Observable<SourcesSseEnvelope> {
    const lastEventId = parseLastEventId(lastEventIdHeader);
    const live$ = this.broker.subscribe(lastEventId);
    const heartbeat$ = interval(this.broker.getHeartbeatMs()).pipe(
      map<number, SourcesSseEnvelope>(() => ({ type: 'heartbeat', data: {} })),
    );
    return merge(live$, heartbeat$);
  }
}

// `0` is the conventional "give me everything in the buffer" cursor and stays
// distinct from `undefined` (no replay).
function parseLastEventId(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}
