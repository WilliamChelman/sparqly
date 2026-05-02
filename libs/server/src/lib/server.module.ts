import { DynamicModule, Module } from '@nestjs/common';
import type { QueryEngine } from 'core';
import { SparqlController } from './sparql.controller';
import {
  SPARQL_CONFIG,
  SPARQL_ENGINE,
  type SparqlServerConfig,
} from './tokens';

export interface ServerModuleOptions {
  engine: QueryEngine;
  config: SparqlServerConfig;
}

@Module({})
export class ServerModule {
  static forRoot(options: ServerModuleOptions): DynamicModule {
    return {
      module: ServerModule,
      controllers: [SparqlController],
      providers: [
        { provide: SPARQL_ENGINE, useValue: options.engine },
        { provide: SPARQL_CONFIG, useValue: options.config },
      ],
    };
  }
}
