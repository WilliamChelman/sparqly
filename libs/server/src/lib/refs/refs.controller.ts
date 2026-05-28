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
  Query,
} from '@nestjs/common';
import {
  discoverRepoRoot,
  type ParsedSource,
  type RepoDiscoveryDeps,
} from 'core';
import { SPARQL_SERVED_REGISTRY } from '../bootstrap';
import { hasGitHistoryForPathspec } from './eligibility-check';
import { fetchRefs } from './fetch-refs';
import { listCommits, type CommitsResponse } from './list-commits';
import { listRefs } from './list-refs';
import { translatePathspec, type PathspecTarget } from './pathspec-translation';
import type { RefsResponse } from './refs-response';
import { resolveRefsSource } from './resolve-refs-source';

const COMMITS_PAGE_SIZE = 50;
const SHA_REGEX = /^[0-9a-f]{40}$/i;

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

interface RefsContext {
  repoRoot: string;
  pathspecTarget: PathspecTarget;
}

@Controller('sources')
export class RefsController {
  constructor(
    @Inject(SPARQL_SERVED_REGISTRY)
    private readonly servedRegistry: ReadonlyArray<ParsedSource>,
  ) {}

  @Get(':id/refs')
  async list(@Param('id') id: string): Promise<RefsResponse> {
    const ctx = this.resolveRefsContext(id);
    const pathspec = translatePathspec(ctx.pathspecTarget);
    const eligible = await hasGitHistoryForPathspec(ctx.repoRoot, pathspec);
    if (!eligible) {
      throw new HttpException(
        { error: 'no-git-history' },
        HttpStatus.NOT_FOUND,
      );
    }
    return listRefs(ctx.repoRoot);
  }

  @Get(':id/commits')
  async commits(
    @Param('id') id: string,
    @Query('ref') ref: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('before') before: string | undefined,
  ): Promise<CommitsResponse> {
    const ctx = this.resolveRefsContext(id);
    const pathspec = translatePathspec(ctx.pathspecTarget);
    const scope = ref ?? 'HEAD';
    if (scope !== 'HEAD' && scope !== '__all__') {
      // Scope is a *named* viewpoint, not a SHA or free-form revision —
      // validate against the same `for-each-ref` listing the /refs endpoint
      // exposes. Anything else (arbitrary SHA, `HEAD~3`, typo) → 400.
      const refs = await listRefs(ctx.repoRoot);
      const known = new Set<string>([
        ...refs.branches.map((b) => b.ref),
        ...refs.remoteBranches.map((r) => r.ref),
        ...refs.tags.map((t) => t.ref),
      ]);
      if (!known.has(scope)) {
        throw new HttpException(
          { error: 'invalid-scope' },
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    if (before !== undefined && !SHA_REGEX.test(before)) {
      throw new HttpException(
        { error: 'invalid-before' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const parsedLimit = limit === undefined ? NaN : Number.parseInt(limit, 10);
    const effectiveLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? parsedLimit
        : COMMITS_PAGE_SIZE;
    const result = await listCommits(ctx.repoRoot, {
      ref: scope,
      pathspec,
      limit: effectiveLimit,
      before,
    });
    if (result.isErr()) {
      throw new HttpException(
        { error: result.error.kind },
        HttpStatus.NOT_FOUND,
      );
    }
    return result.value;
  }

  @Post(':id/refs/fetch')
  @HttpCode(HttpStatus.OK)
  async fetch(@Param('id') id: string): Promise<RefsResponse> {
    const ctx = this.resolveRefsContext(id);
    const result = await fetchRefs(ctx.repoRoot);
    if (result.isErr()) {
      throw new HttpException(
        { error: 'fetch-failed', kind: result.error.kind },
        HttpStatus.BAD_GATEWAY,
      );
    }
    return result.value;
  }

  private resolveRefsContext(id: string): RefsContext {
    const resolution = resolveRefsSource(id, this.servedRegistry);
    if (resolution.isErr()) {
      const failure = resolution.error;
      if (failure.kind === 'unknown-source') {
        throw new NotFoundException({ error: 'unknown-source', id });
      }
      if (failure.kind === 'pin-unsupported') {
        // `storage: disk` globs can't be pinned — don't offer a ref list to pin against.
        throw new HttpException(
          { error: 'pin-unsupported', reason: failure.reason },
          HttpStatus.NOT_FOUND,
        );
      }
      throw new HttpException(
        { error: 'no-git-repo', kind: failure.terminatingKind },
        HttpStatus.NOT_FOUND,
      );
    }
    const { glob, filePath } = resolution.value;
    const configDir = process.cwd();
    const discovery = discoverRepoRoot(
      {
        glob: glob.glob,
        configDir,
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
    const repoRoot = discovery.value;
    const pathspecTarget: PathspecTarget =
      filePath === undefined
        ? { kind: 'glob', pattern: glob.glob, configDir, repoRoot }
        : { kind: 'file', path: filePath, repoRoot };
    return { repoRoot, pathspecTarget };
  }
}
