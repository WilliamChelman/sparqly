import { execFile, spawn } from 'node:child_process';
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

  async listFilesAtSha(
    repoRoot: string,
    sha: string,
  ): Promise<ReadonlyArray<string>> {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', repoRoot, 'ls-tree', '-r', '--name-only', sha],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    if (stdout.length === 0) return [];
    return stdout.split('\n').filter((line) => line.length > 0);
  }

  async *readManyAtSha(
    repoRoot: string,
    sha: string,
    repoRelPaths: ReadonlyArray<string>,
  ): AsyncIterable<{ path: string; bytes: Buffer | null }> {
    if (repoRelPaths.length === 0) return;

    const child = spawn('git', ['-C', repoRoot, 'cat-file', '--batch'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let spawnError: Error | null = null;
    child.on('error', (err) => {
      spawnError = err;
    });
    child.stdin.on('error', () => {
      // Swallow EPIPE on stdin if the child exits early; the read side surfaces the real error.
    });

    try {
      for (const p of repoRelPaths) {
        child.stdin.write(`${sha}:${p}\n`);
      }
      child.stdin.end();

      const reader = child.stdout[Symbol.asyncIterator]();
      let buf: Buffer = Buffer.alloc(0);

      const refill = async (): Promise<boolean> => {
        const { value, done } = await reader.next();
        if (done === true) return false;
        buf = Buffer.concat([buf, value as Buffer]);
        return true;
      };

      for (const requestPath of repoRelPaths) {
        let nl = buf.indexOf(0x0a);
        while (nl === -1) {
          const more = await refill();
          if (!more) {
            if (spawnError !== null) throw spawnError;
            throw new Error(
              'git cat-file --batch: unexpected EOF before response header',
            );
          }
          nl = buf.indexOf(0x0a);
        }
        const header = buf.subarray(0, nl).toString('utf8');
        buf = buf.subarray(nl + 1);

        if (header.endsWith(' missing')) {
          yield { path: requestPath, bytes: null };
          continue;
        }

        const lastSpace = header.lastIndexOf(' ');
        const size = Number.parseInt(header.slice(lastSpace + 1), 10);
        if (!Number.isFinite(size) || size < 0) {
          throw new Error(
            `git cat-file --batch: bad header for ${requestPath}: "${header}"`,
          );
        }

        while (buf.length < size + 1) {
          const more = await refill();
          if (!more) {
            if (spawnError !== null) throw spawnError;
            throw new Error(
              `git cat-file --batch: unexpected EOF in payload for ${requestPath}`,
            );
          }
        }
        const payload = Buffer.from(buf.subarray(0, size));
        buf = buf.subarray(size + 1);
        yield { path: requestPath, bytes: payload };
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    }
  }
}
