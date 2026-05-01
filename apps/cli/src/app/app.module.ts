import { Module } from '@nestjs/common';
import { DiffCommand } from './diff.command';
import { FormatCommand } from './format.command';
import { QueryCommand } from './query.command';
import { ServeCommand } from './serve.command';

@Module({
  providers: [DiffCommand, FormatCommand, QueryCommand, ServeCommand],
})
export class AppModule {}
