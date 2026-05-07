import { DynamicModule, Module, type Type } from '@nestjs/common';
import type { QueryEngine } from 'core';
import type { EngineMap } from './engine-map';
import { RegistrySparqlController } from './registry-sparql.controller';
import { SourcesController } from './sources.controller';
import { SparqlController } from './sparql.controller';
import {
  SPARQL_CONFIG,
  SPARQL_ENGINE,
  SPARQL_ENGINE_MAP,
  SPARQL_REGISTRY_LISTING,
  type SourceListingEntry,
  type SparqlServerConfig,
} from './tokens';

export interface SingleSourceModuleOptions {
  mode: 'single';
  engine: QueryEngine;
  listing: ReadonlyArray<SourceListingEntry>;
  config: SparqlServerConfig;
}

export interface RegistryModuleOptions {
  mode: 'registry';
  engineMap: EngineMap;
  listing: ReadonlyArray<SourceListingEntry>;
  config: SparqlServerConfig;
}

export type ServerModuleOptions =
  | SingleSourceModuleOptions
  | RegistryModuleOptions;

@Module({})
export class ServerModule {
  static forRoot(options: ServerModuleOptions): DynamicModule {
    const controllers: Type<unknown>[] = [];
    const providers: DynamicModule['providers'] = [
      { provide: SPARQL_CONFIG, useValue: options.config },
    ];
    if (options.mode === 'single') {
      controllers.push(SparqlController, SourcesController);
      providers.push(
        { provide: SPARQL_ENGINE, useValue: options.engine },
        { provide: SPARQL_REGISTRY_LISTING, useValue: options.listing },
      );
    } else {
      controllers.push(SourcesController, RegistrySparqlController);
      providers.push(
        { provide: SPARQL_ENGINE_MAP, useValue: options.engineMap },
        { provide: SPARQL_REGISTRY_LISTING, useValue: options.listing },
      );
    }
    return { module: ServerModule, controllers, providers };
  }
}
