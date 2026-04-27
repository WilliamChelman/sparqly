import { DynamicModule, Module } from '@nestjs/common';
import type { Store } from 'n3';
import { SparqlController } from './sparql.controller';
import { SPARQL_CONFIG, SPARQL_STORE, type SparqlServerConfig } from './tokens';

export interface ServerModuleOptions {
  store: Store;
  config: SparqlServerConfig;
}

@Module({})
export class ServerModule {
  static forRoot(options: ServerModuleOptions): DynamicModule {
    return {
      module: ServerModule,
      controllers: [SparqlController],
      providers: [
        { provide: SPARQL_STORE, useValue: options.store },
        { provide: SPARQL_CONFIG, useValue: options.config },
      ],
    };
  }
}
