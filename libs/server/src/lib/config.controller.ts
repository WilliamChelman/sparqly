import { Controller, Get, Inject } from '@nestjs/common';
import {
  SPARQL_CONTEXT,
  SPARQL_REGISTRY_LISTING,
  type SourceListingEntry,
  type SparqlContext,
} from './tokens';

@Controller('config')
export class ConfigController {
  constructor(
    @Inject(SPARQL_REGISTRY_LISTING)
    private readonly listing: ReadonlyArray<SourceListingEntry>,
    @Inject(SPARQL_CONTEXT)
    private readonly context: SparqlContext,
  ) {}

  @Get()
  list(): {
    sources: ReadonlyArray<SourceListingEntry>;
    context: SparqlContext;
  } {
    return { sources: this.listing, context: this.context };
  }
}
