import { DynamicModule, Module, type Type } from '@nestjs/common';
import type { ParsedSource, QueryEngine } from 'core';
import { ConfigController } from './config.controller';
import { DescribeController } from './describe.controller';
import { DescribeService } from './describe.service';
import { DiffController } from './diff.controller';
import { DiffService } from './diff.service';
import type { EngineMap } from './engine-map';
import { RegistrySparqlController } from './registry-sparql.controller';
import { SnippetAllowList } from './snippet-allow-list';
import { SnippetController } from './snippet.controller';
import { SparqlController } from './sparql.controller';
import {
  SPARQL_CONFIG,
  SPARQL_CONTEXT,
  SPARQL_DESCRIBE_SERVICE,
  SPARQL_DIFF_SERVICE,
  SPARQL_ENGINE,
  SPARQL_ENGINE_MAP,
  SPARQL_REGISTRY_LISTING,
  SPARQL_SNIPPET_ALLOW_LIST,
  type SourceListingEntry,
  type SparqlContext,
  type SparqlServerConfig,
} from './tokens';

export interface SingleSourceModuleOptions {
  mode: 'single';
  engine: QueryEngine;
  listing: ReadonlyArray<SourceListingEntry>;
  config: SparqlServerConfig;
  context: SparqlContext;
  snippetAllowList: SnippetAllowList;
}

export interface RegistryModuleOptions {
  mode: 'registry';
  engineMap: EngineMap;
  registry: ReadonlyArray<ParsedSource>;
  listing: ReadonlyArray<SourceListingEntry>;
  config: SparqlServerConfig;
  context: SparqlContext;
  snippetAllowList: SnippetAllowList;
}

export type ServerModuleOptions =
  | SingleSourceModuleOptions
  | RegistryModuleOptions;

@Module({})
export class ServerModule {
  static forRoot(options: ServerModuleOptions): DynamicModule {
    const controllers: Type<unknown>[] = [SnippetController];
    const providers: DynamicModule['providers'] = [
      { provide: SPARQL_CONFIG, useValue: options.config },
      { provide: SPARQL_CONTEXT, useValue: options.context },
      {
        provide: SPARQL_SNIPPET_ALLOW_LIST,
        useValue: options.snippetAllowList,
      },
    ];
    if (options.mode === 'single') {
      controllers.push(SparqlController, ConfigController);
      providers.push(
        { provide: SPARQL_ENGINE, useValue: options.engine },
        { provide: SPARQL_REGISTRY_LISTING, useValue: options.listing },
      );
    } else {
      controllers.push(
        ConfigController,
        RegistrySparqlController,
        DiffController,
        DescribeController,
      );
      providers.push(
        { provide: SPARQL_ENGINE_MAP, useValue: options.engineMap },
        { provide: SPARQL_REGISTRY_LISTING, useValue: options.listing },
        {
          provide: SPARQL_DIFF_SERVICE,
          useValue: new DiffService(options.registry),
        },
        {
          provide: SPARQL_DESCRIBE_SERVICE,
          useValue: new DescribeService(options.registry),
        },
      );
    }
    return { module: ServerModule, controllers, providers };
  }
}
