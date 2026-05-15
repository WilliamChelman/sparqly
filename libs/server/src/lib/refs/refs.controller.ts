import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
} from '@nestjs/common';
import {
  discoverRepoRoot,
  type ParsedSource,
  type RepoDiscoveryDeps,
} from 'core';
import { SPARQL_SERVED_REGISTRY } from '../bootstrap';
import { listRefs } from './list-refs';
import type { RefsResponse } from './refs-response';

const repoDiscovery: RepoDiscoveryDeps = {
  hasGitDir(dir: string): boolean {
    const candidate = join(dir, '.git');
    if (!existsSync(candidate)) return false;
    try {
      return statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  },
};

@Controller('sources')
export class RefsController {
  constructor(
    @Inject(SPARQL_SERVED_REGISTRY)
    private readonly servedRegistry: ReadonlyArray<ParsedSource>,
  ) {}

  @Get(':id/refs')
  async list(@Param('id') id: string): Promise<RefsResponse> {
    const source = this.servedRegistry.find((s) => s.id === id);
    if (!source) {
      throw new NotFoundException({
        error: 'unknown-source',
        id,
      });
    }
    if (source.kind !== 'glob') {
      throw new HttpException(
        { error: 'no-git-repo', kind: source.kind },
        HttpStatus.NOT_FOUND,
      );
    }
    const discovery = discoverRepoRoot(
      {
        glob: source.glob,
        configDir: process.cwd(),
        gitRoot: source.gitRoot,
      },
      repoDiscovery,
    );
    if (discovery.isErr()) {
      throw new HttpException(
        { error: 'no-git-repo', kind: source.kind, reason: discovery.error.kind },
        HttpStatus.NOT_FOUND,
      );
    }
    return listRefs(discovery.value);
  }
}
