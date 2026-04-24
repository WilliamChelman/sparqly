import { Module } from '@nestjs/common';
import { QueryCommand } from './query.command';
import { ServeCommand } from './serve.command';

@Module({
  providers: [QueryCommand, ServeCommand],
})
export class AppModule {}
