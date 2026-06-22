import {
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import {
  EngineMap,
  SPARQL_CACHE_ADMIN_CONFIG,
  SPARQL_ENGINE_MAP,
  type CacheAdminServerConfig,
} from '../bootstrap';

/**
 * The Query cache's admin surface under `serve` (ADR-0054, #418). Caching
 * reads/writes happen on the query path; this controller carries only the
 * `cache clear` action — the one cache operation `serve --read-only` gates.
 */
@Controller('cache')
export class CacheController {
  constructor(
    @Inject(SPARQL_ENGINE_MAP) private readonly engineMap: EngineMap,
    @Inject(SPARQL_CACHE_ADMIN_CONFIG)
    private readonly adminConfig: CacheAdminServerConfig,
  ) {}

  @Post('clear')
  @HttpCode(HttpStatus.OK)
  clear(): { cleared: true } {
    if (!this.adminConfig.allowClear) {
      throw new ForbiddenException({ error: 'admin-actions-disabled' });
    }
    this.engineMap.clearQueryCache();
    return { cleared: true };
  }
}
