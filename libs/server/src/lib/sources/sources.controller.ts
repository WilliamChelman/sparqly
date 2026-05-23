import { Controller, Get, Inject } from '@nestjs/common';
import type { ParsedSource } from 'core';
import {
  SPARQL_ENGINE_MAP,
  SPARQL_SERVED_REGISTRY,
  type EngineMapProvider,
} from '../bootstrap/tokens';
import { projectSourceRow, type SourceRow } from './source-row-projector';

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
}
