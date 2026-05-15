import { DynamicModule, Module } from '@nestjs/common';
import type { ParsedSource } from 'core';
import { ConfigController } from '../config';
import {
  DescribeController,
  DescribeService,
  type DescribeConfig,
} from '../describe';
import { DiffController, DiffService } from '../diff';
import type { EngineMap } from './engine-map';
import type { MetaChildrenCache } from './meta-children-cache';
import { RegistrySparqlController } from '../sparql';
import { RefsController } from '../refs';
import {
  SnippetAllowList,
  SnippetController,
  SnippetService,
  SNIPPET_READER,
  createDefaultSnippetReader,
} from '../snippet';
import {
  SPARQL_CONFIG,
  SPARQL_CONTEXT,
  SPARQL_DEFAULT_ID,
  SPARQL_DESCRIBE_CONFIG,
  SPARQL_DESCRIBE_SERVICE,
  SPARQL_DIFF_SERVICE,
  SPARQL_ENGINE_MAP,
  SPARQL_META_CHILDREN_CACHE,
  SPARQL_RESOLUTION_REGISTRY,
  SPARQL_SERVED_REGISTRY,
  SPARQL_SNIPPET_ALLOW_LIST,
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
  /**
   * Per-meta children cache for `splitByFile: true` globs (ADR-0027). Drives
   * the dynamic `/api/config` listing: watcher events invalidate per parent,
   * and the next request re-walks the meta's glob to refresh children.
   */
  metaChildrenCache: MetaChildrenCache;
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
        RefsController,
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
        {
          provide: SPARQL_META_CHILDREN_CACHE,
          useValue: options.metaChildrenCache,
        },
        { provide: SPARQL_DEFAULT_ID, useValue: options.defaultId },
        { provide: SPARQL_SERVED_REGISTRY, useValue: options.servedRegistry },
        {
          provide: SPARQL_RESOLUTION_REGISTRY,
          useValue: options.resolutionRegistry,
        },
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
        { provide: SNIPPET_READER, useValue: createDefaultSnippetReader() },
        SnippetService,
      ],
    };
  }
}
