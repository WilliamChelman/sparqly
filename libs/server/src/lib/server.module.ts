import { Module } from '@nestjs/common';
import { SparqlController } from './sparql.controller';

@Module({
  controllers: [SparqlController],
})
export class ServerModule {}
