import { Controller, Get, Inject } from '@nestjs/common';
import {
  SPARQL_REGISTRY_LISTING,
  type SourceListingEntry,
} from './tokens';

@Controller('sources')
export class SourcesController {
  constructor(
    @Inject(SPARQL_REGISTRY_LISTING)
    private readonly listing: ReadonlyArray<SourceListingEntry>,
  ) {}

  @Get()
  list(): { sources: ReadonlyArray<SourceListingEntry> } {
    return { sources: this.listing };
  }
}
