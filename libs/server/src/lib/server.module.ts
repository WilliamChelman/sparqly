import { DynamicModule, Module } from '@nestjs/common';
import type { ParsedSource } from 'core';
import { ConfigController } from './config.controller';
import { DescribeController } from './describe.controller';
import { DescribeService, type DescribeConfig } from './describe.service';
import { DiffController } from './diff.controller';
import { DiffService } from './diff.service';
import type { EngineMap } from './engine-map';
import { RegistrySparqlController } from './registry-sparql.controller';
import { SnippetAllowList } from './snippet-allow-list';
import { SnippetController } from './snippet.controller';
import {
  SPARQL_CONFIG,
  SPARQL_CONTEXT,
  SPARQL_DEFAULT_ID,
  SPARQL_DESCRIBE_CONFIG,
  SPARQL_DESCRIBE_SERVICE,
  SPARQL_DIFF_SERVICE,
  SPARQL_ENGINE_MAP,
  SPARQL_REGISTRY_LISTING,
  SPARQL_SNIPPET_ALLOW_LIST,
  type SourceListingEntry,
  type SparqlContext,
  type SparqlServerConfig,
} from './tokens';

export interface ServerModuleOptions {
  /** Engines for the served sources (eager for materialized, lazy for pass-through). */
  engineMap: EngineMap;
  /**
   * The sources `serve` exposes: routed at `/api/sparql/<id>`, listed via
   * `/api/config`, and the default enumeration set for `/api/diff` and
   * `/api/describe`.
   */
  servedRegistry: ReadonlyArray<ParsedSource>;
  /**
   * Resolution registry — a superset of the served set used to walk `from:`
   * chains (e.g. a scoped `@view`'s upstreams that are otherwise unlisted).
   */
  resolutionRegistry: ReadonlyArray<ParsedSource>;
  /** The served registry's `/api/config` listing. */
  listing: ReadonlyArray<SourceListingEntry>;
  /** `@id` the unparameterized `/api/sparql` forwards to, or `undefined` if none. */
  defaultId: string | undefined;
  config: SparqlServerConfig;
  context: SparqlContext;
  describe: DescribeConfig;
  snippetAllowList: SnippetAllowList;
}

@Module({})
export class ServerModule {
  static forRoot(options: ServerModuleOptions): DynamicModule {
    return {
      module: ServerModule,
      controllers: [
        ConfigController,
        RegistrySparqlController,
        DiffController,
        DescribeController,
        SnippetController,
      ],
      providers: [
        { provide: SPARQL_CONFIG, useValue: options.config },
        { provide: SPARQL_CONTEXT, useValue: options.context },
        { provide: SPARQL_DESCRIBE_CONFIG, useValue: options.describe },
        { provide: SPARQL_SNIPPET_ALLOW_LIST, useValue: options.snippetAllowList },
        { provide: SPARQL_ENGINE_MAP, useValue: options.engineMap },
        { provide: SPARQL_REGISTRY_LISTING, useValue: options.listing },
        { provide: SPARQL_DEFAULT_ID, useValue: options.defaultId },
        {
          provide: SPARQL_DIFF_SERVICE,
          useValue: new DiffService(
            options.servedRegistry,
            options.resolutionRegistry,
          ),
        },
        {
          provide: SPARQL_DESCRIBE_SERVICE,
          useValue: new DescribeService(
            options.servedRegistry,
            options.describe,
            options.resolutionRegistry,
          ),
        },
      ],
    };
  }
}
