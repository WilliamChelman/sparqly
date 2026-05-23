import { Controller, Get, Headers, Inject, Sse } from '@nestjs/common';
import type { ParsedSource } from 'core';
import { interval, merge, type Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  SPARQL_ENGINE_MAP,
  SPARQL_SERVED_REGISTRY,
  SPARQL_SOURCE_STATE_BROKER,
  type EngineMapProvider,
} from '../bootstrap/tokens';
import { projectSourceRow, type SourceRow } from './source-row-projector';
import type {
  SourcesSseEnvelope,
  SourceStateBroker,
} from './source-state-broker';

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
