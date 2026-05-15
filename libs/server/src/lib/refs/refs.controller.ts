import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  discoverRepoRoot,
  type ParsedSource,
  type RepoDiscoveryDeps,
} from 'core';
import { SPARQL_SERVED_REGISTRY } from '../bootstrap';
import { fetchRefs } from './fetch-refs';
import { listRefs } from './list-refs';
import type { RefsResponse } from './refs-response';
import { resolveRefsSource } from './resolve-refs-source';

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
    const repoRoot = this.resolveRepoRoot(id);
    return listRefs(repoRoot);
  }

  @Post(':id/refs/fetch')
  @HttpCode(HttpStatus.OK)
  async fetch(@Param('id') id: string): Promise<RefsResponse> {
    const repoRoot = this.resolveRepoRoot(id);
    const result = await fetchRefs(repoRoot);
    if (result.isErr()) {
      throw new HttpException(
        { error: 'fetch-failed', kind: result.error.kind },
        HttpStatus.BAD_GATEWAY,
      );
    }
    return result.value;
  }

  private resolveRepoRoot(id: string): string {
    const resolution = resolveRefsSource(id, this.servedRegistry);
    if (resolution.isErr()) {
      const failure = resolution.error;
      if (failure.kind === 'unknown-source') {
        throw new NotFoundException({ error: 'unknown-source', id });
      }
      throw new HttpException(
        { error: 'no-git-repo', kind: failure.terminatingKind },
        HttpStatus.NOT_FOUND,
      );
    }
    const glob = resolution.value;
    const discovery = discoverRepoRoot(
      {
        glob: glob.glob,
        configDir: process.cwd(),
        gitRoot: glob.gitRoot,
      },
      repoDiscovery,
    );
    if (discovery.isErr()) {
      throw new HttpException(
        { error: 'no-git-repo', kind: 'glob', reason: discovery.error.kind },
        HttpStatus.NOT_FOUND,
      );
    }
    return discovery.value;
  }
}
