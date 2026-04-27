import { DynamicModule, Module } from '@nestjs/common';
import { SparqlController } from './sparql.controller';
import {
  SPARQL_CONFIG,
  SPARQL_STORE_REF,
  type SparqlServerConfig,
  type StoreRef,
} from './tokens';

export interface ServerModuleOptions {
  storeRef: StoreRef;
  config: SparqlServerConfig;
}

@Module({})
export class ServerModule {
  static forRoot(options: ServerModuleOptions): DynamicModule {
    return {
      module: ServerModule,
      controllers: [SparqlController],
      providers: [
        { provide: SPARQL_STORE_REF, useValue: options.storeRef },
        { provide: SPARQL_CONFIG, useValue: options.config },
      ],
    };
  }
}
