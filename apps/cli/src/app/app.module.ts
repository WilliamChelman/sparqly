import { Module } from '@nestjs/common';
import { DiffCommand } from './diff.command';
import { HashCommand } from './hash.command';
import { QueryCommand } from './query.command';
import { ServeCommand } from './serve.command';

@Module({
  providers: [DiffCommand, HashCommand, QueryCommand, ServeCommand],
})
export class AppModule {}
