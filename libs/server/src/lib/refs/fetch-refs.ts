import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { err, ok, type Result } from 'neverthrow';
import { listRefs } from './list-refs';
import type { RefsResponse } from './refs-response';

const execFileAsync = promisify(execFile);

export type FetchError =
  | { kind: 'no-remote' }
  | { kind: 'auth-failed' }
  | { kind: 'network' };

async function hasAnyRemote(repoRoot: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'remote'], {
      encoding: 'utf8',
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function fetchRefs(
  repoRoot: string,
): Promise<Result<RefsResponse, FetchError>> {
  if (!(await hasAnyRemote(repoRoot))) {
    return err({ kind: 'no-remote' });
  }
  try {
    await execFileAsync('git', ['-C', repoRoot, 'fetch', '--all', '--prune'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return err({ kind: 'network' });
  }
  const refs = await listRefs(repoRoot);
  return ok(refs);
}
