import { Controller, Get, Inject } from '@nestjs/common';
import type { DescribeConfig } from '../describe';
import {
  SPARQL_CONTEXT,
  SPARQL_DESCRIBE_CONFIG,
  SPARQL_REGISTRY_LISTING,
  type SourceListingEntry,
  type SparqlContext,
} from '../bootstrap';

@Controller('config')
export class ConfigController {
  constructor(
    @Inject(SPARQL_REGISTRY_LISTING)
    private readonly listing: ReadonlyArray<SourceListingEntry>,
    @Inject(SPARQL_CONTEXT)
    private readonly context: SparqlContext,
    @Inject(SPARQL_DESCRIBE_CONFIG)
    private readonly describe: DescribeConfig,
  ) {}

  @Get()
  list(): {
    sources: ReadonlyArray<SourceListingEntry>;
    context: SparqlContext;
    describe: DescribeConfig;
  } {
    return {
      sources: this.listing,
      context: this.context,
      describe: this.describe,
    };
  }
}
