import {
  Controller,
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
import { projectSourceRow, type SourceRow } from './source-row-projector';
import type {
  SourcesSseEnvelope,
  SourceStateBroker,
} from './source-state-broker';

/**
 * Per-row response shape for the mutating Sources page routes (#356). Kept
 * deliberately bare — `{ id, state }` is enough for the webapp to flip its
 * action menu over to the new verbs; the rest of the row (metrics, default
 * flag, kind) lives on the SSE-pushed snapshot or the next `GET /api/sources`
 * fetch. Routes return `202 Accepted` so the HTTP turn never blocks waiting
 * on a long resolve.
 */
export interface SourceAdminActionResponse {
  id: string;
  /**
   * The current **Source load state** label, post-action. Spelt with the
   * mode-specific labels (`not-loaded`/`loading`/`loaded`/`failed` for
   * in-memory; the disk-backed labels arrive in a later slice of #352).
   */
  state: string;
}

/**
 * `GET /api/sources` — Sources page snapshot (#353, parent #352). Returns one
 * Layer 1 row per served registry entry, projected through
 * {@link projectSourceRow}. The endpoint is **never gated** — read-only
 * monitoring keeps working under `sources.allowAdminActions: false`
 * (ADR-0045). Snapshot reads never trigger lazy materialization (ADR-0031):
 * the rows are derived from `EngineMap.readState`, which observes existing
 * entry state without touching the loader.
 */
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
      // CONTEXT.md, **Served registry**: reference sources are never
      // themselves served — they exist only to be reached through `from:`
      // chains. The Sources page never renders them.
      if (source.kind === 'reference') continue;
      if (source.id === undefined) continue;
      const runtime = await this.engineMap.readState(source.id);
      rows.push(projectSourceRow(source, runtime));
    }
    return rows;
  }

  /**
   * `GET /api/sources/stream` — live **Source load state** transitions via
   * Server-Sent Events (ADR-0044, #354). Like the snapshot endpoint, this
   * route is **never gated** by `sources.allowAdminActions` — read-only
   * monitoring dashboards keep working on a public `serve --read-only`
   * (ADR-0045). The full {@link SourceRow} is the event payload so the
   * client can blindly replace by id; no diff, no delta merging.
   *
   * Layer 1 — only the heartbeat-keep-alive skeleton is wired here.
   * Reconnect replay via `Last-Event-ID` and the live `SourceStateBroker`
   * arrive in subsequent slices of #354.
   */
  /**
   * `POST /api/sources/:id/load` — operator-initiated warm of an in-memory
   * entry (ADR-0045, #356). Idempotent: a `load` against an already-loaded
   * entry short-circuits to the memoized engine; against `not-loaded` it
   * fires the same `EngineMap.ensure(id)` path a first query touch would.
   * Returns `202 Accepted` with the post-action state — the HTTP turn never
   * blocks long enough to be worth a synchronous `200`. Gated by
   * `sourcesAdmin.allowAdminActions`; `403` when the deployment is read-only.
   */
  @Post(':id/load')
  @HttpCode(HttpStatus.ACCEPTED)
  async load(@Param('id') id: string): Promise<SourceAdminActionResponse> {
    this.assertAdminAllowed();
    this.assertKnownId(id);
    // `ensure(id)` is the same code path lazy materialization runs on first
    // query touch (ADR-0031). A failing load clears the memoization slot
    // (#290) so the next click can retry — we surface the post-action state
    // either way; the SSE stream carried the `load-failure` transition
    // separately and the webapp will render the failed chip.
    await this.engineMap.ensure(id);
    return this.respondWithState(id);
  }

  /**
   * `POST /api/sources/:id/reload` — atomic-swap rebuild of an in-memory
   * entry's materialized store (#356). In-flight queries against the prior
   * store finish naturally (the `StoreRef` swap pattern from the watcher).
   * Idempotent — a reload against a `not-loaded` entry behaves as a first
   * load. Same `202`/`403` shape as `load`.
   */
  @Post(':id/reload')
  @HttpCode(HttpStatus.ACCEPTED)
  async reload(@Param('id') id: string): Promise<SourceAdminActionResponse> {
    this.assertAdminAllowed();
    this.assertKnownId(id);
    await this.engineMap.reload(id);
    return this.respondWithState(id);
  }

  /**
   * `POST /api/sources/:id/unload` — drops the live materialization of an
   * in-memory entry so RAM is released (#356). Idempotent — unloading an
   * already-`not-loaded` entry is a silent no-op. In-flight queries continue
   * against the snapshot they captured; `unload` never cancels them. Same
   * `202`/`403` shape as `load`/`reload`.
   */
  @Post(':id/unload')
  @HttpCode(HttpStatus.ACCEPTED)
  async unload(@Param('id') id: string): Promise<SourceAdminActionResponse> {
    this.assertAdminAllowed();
    this.assertKnownId(id);
    await this.engineMap.unload(id);
    return this.respondWithState(id);
  }

  /**
   * Refuses with `403 Forbidden` when the deployment's **Source admin
   * actions capability** is off (ADR-0045, #356). Independent from
   * `savedQueries.writable` — the two mutation classes gate separately.
   */
  private assertAdminAllowed(): void {
    if (this.adminConfig.allowAdminActions) return;
    throw new ForbiddenException({ error: 'admin-actions-disabled' });
  }

  /**
   * Refuses with `404 Not Found` when `:id` isn't in the served registry.
   * Better than letting `EngineMap.ensure(id)` throw — the route stays
   * within HTTP semantics for the cascade caller (a split-glob client
   * iterating loaded children must distinguish "wrong id, fix your code"
   * from "transient load failure, retry").
   */
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

/**
 * Parses the `Last-Event-ID` SSE reconnect header. Returns `undefined`
 * when the header is missing or unparseable — a fresh subscriber gets no
 * replay. A `0` cursor is the conventional "give me everything in the
 * buffer" and stays distinct from `undefined`.
 */
function parseLastEventId(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}
