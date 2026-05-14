import { Controller, Get, Inject } from '@nestjs/common';
import type { ParsedSource } from 'core';
import type { DescribeConfig } from '../describe';
import {
  MetaChildrenCache,
  SPARQL_CONTEXT,
  SPARQL_DESCRIBE_CONFIG,
  SPARQL_META_CHILDREN_CACHE,
  SPARQL_SERVED_REGISTRY,
  type SourceListingEntry,
  type SparqlContext,
} from '../bootstrap';

@Controller('config')
export class ConfigController {
  constructor(
    @Inject(SPARQL_SERVED_REGISTRY)
    private readonly servedRegistry: ReadonlyArray<ParsedSource>,
    @Inject(SPARQL_META_CHILDREN_CACHE)
    private readonly metaChildrenCache: MetaChildrenCache,
    @Inject(SPARQL_CONTEXT)
    private readonly context: SparqlContext,
    @Inject(SPARQL_DESCRIBE_CONFIG)
    private readonly describe: DescribeConfig,
  ) {}

  @Get()
  async list(): Promise<{
    sources: ReadonlyArray<SourceListingEntry>;
    context: SparqlContext;
    describe: DescribeConfig;
  }> {
    const sources = await this.buildListing();
    return {
      sources,
      context: this.context,
      describe: this.describe,
    };
  }

  private async buildListing(): Promise<SourceListingEntry[]> {
    const out: SourceListingEntry[] = [];
    for (const src of this.servedRegistry) {
      if (src.kind === 'reference') continue;
      if (src.kind === 'file') continue;
      if (src.id === undefined) continue;
      const entry: SourceListingEntry = {
        id: src.id,
        kind: src.kind,
        label: src.id,
      };
      if ((src as { default?: true }).default === true) entry.default = true;
      out.push(entry);
      if (
        src.kind === 'glob' &&
        src.splitByFile === true &&
        this.metaChildrenCache.hasParent(src.id)
      ) {
        const children = await this.metaChildrenCache.getChildren(src.id);
        for (const child of children) {
          out.push({
            id: child.id,
            kind: 'file',
            label: child.id,
            parentId: child.parentId,
          });
        }
      }
    }
    return out;
  }
}
