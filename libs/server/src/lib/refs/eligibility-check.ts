import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function hasGitHistoryForPathspec(
  repoRoot: string,
  pathspec: string,
): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      [
        '-C',
        repoRoot,
        'log',
        '--all',
        '--max-count=1',
        '--format=%H',
        '--',
        pathspec,
      ],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
