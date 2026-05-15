import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitPort } from './git-port';

const execFileAsync = promisify(execFile);

/**
 * Production {@link GitPort} implementation. Shells out to the system `git`
 * binary. v1 per ADR-0029; we may swap for libgit2 / isomorphic-git if perf or
 * ergonomics push back.
 */
export class GitCliPort implements GitPort {
  async resolveRefToSha(repoRoot: string, ref: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', repoRoot, 'rev-parse', '--verify', `${ref}^{commit}`],
        { encoding: 'utf8' },
      );
      const sha = stdout.trim();
      return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
    } catch {
      return null;
    }
  }

  async getRefObjectType(
    repoRoot: string,
    ref: string,
  ): Promise<'tag' | 'commit' | 'tree' | 'blob' | null> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', repoRoot, 'cat-file', '-t', ref],
        { encoding: 'utf8' },
      );
      const t = stdout.trim();
      if (t === 'tag' || t === 'commit' || t === 'tree' || t === 'blob') {
        return t;
      }
      return null;
    } catch {
      return null;
    }
  }

  async readFileAtSha(
    repoRoot: string,
    sha: string,
    repoRelPath: string,
  ): Promise<Buffer | null> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', repoRoot, 'show', `${sha}:${repoRelPath}`],
        { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
      );
      return stdout;
    } catch {
      return null;
    }
  }
}
