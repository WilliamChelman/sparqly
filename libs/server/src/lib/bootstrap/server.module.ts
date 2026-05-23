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
import {
  SavedQueriesController,
  SavedQueriesService,
} from '../saved-queries';
import { RegistrySparqlController } from '../sparql';
import { RefsController } from '../refs';
import { SourceStateBroker, SourcesController } from '../sources';
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
  SPARQL_SAVED_QUERIES_CONFIG,
  SPARQL_SAVED_QUERIES_SERVICE,
  SPARQL_SERVED_REGISTRY,
  SPARQL_SNIPPET_ALLOW_LIST,
  SPARQL_SOURCE_STATE_BROKER,
  SPARQL_SOURCES_ADMIN_CONFIG,
  type SavedQueriesServerConfig,
  type SourcesAdminServerConfig,
  type SparqlContext,
  type SparqlServerConfig,
} from './tokens';

export interface ServerModuleOptions {
  engineMap: EngineMap;
  servedRegistry: ReadonlyArray<ParsedSource>;
  /** Superset of `servedRegistry` used to walk `from:` chains. */
  resolutionRegistry: ReadonlyArray<ParsedSource>;
  metaChildrenCache: MetaChildrenCache;
  /** `@id` the unparameterized `/api/sparql` forwards to. */
  defaultId: string | undefined;
  config: SparqlServerConfig;
  context: SparqlContext;
  describe: DescribeConfig;
  snippetAllowList: SnippetAllowList;
  savedQueries: SavedQueriesServerConfig;
  sourcesAdmin: SourcesAdminServerConfig;
  sourceStateBroker: SourceStateBroker;
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
        SavedQueriesController,
        SourcesController,
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
            options.engineMap,
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
        { provide: SPARQL_SAVED_QUERIES_CONFIG, useValue: options.savedQueries },
        {
          provide: SPARQL_SAVED_QUERIES_SERVICE,
          useValue: new SavedQueriesService(options.savedQueries),
        },
        {
          provide: SPARQL_SOURCE_STATE_BROKER,
          useValue: options.sourceStateBroker,
        },
        {
          provide: SPARQL_SOURCES_ADMIN_CONFIG,
          useValue: options.sourcesAdmin,
        },
      ],
    };
  }
}
