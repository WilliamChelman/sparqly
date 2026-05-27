import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { err, ok, type Result } from 'neverthrow';

const execFileAsync = promisify(execFile);

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
const LOG_FORMAT = ['%H', '%s', '%an', '%aI', '%P'].join(FIELD_SEP);

export interface ListCommitsOptions {
  readonly ref: string;
  readonly pathspec: string;
  readonly limit: number;
}

export interface CommitEntry {
  readonly sha: string;
  readonly shortSha: string;
  readonly subject: string;
  readonly authorName: string;
  readonly authorDate: string;
  readonly parents: ReadonlyArray<string>;
}

export interface CommitsResponse {
  readonly commits: ReadonlyArray<CommitEntry>;
  readonly nextBefore: string | null;
}

export type ListCommitsError =
  | { kind: 'bad-ref' }
  | { kind: 'git-io' };

export async function listCommits(
  repoRoot: string,
  options: ListCommitsOptions,
): Promise<Result<CommitsResponse, ListCommitsError>> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      'git',
      [
        '-C',
        repoRoot,
        'log',
        options.ref,
        `--max-count=${options.limit}`,
        `--format=${LOG_FORMAT}${RECORD_SEP}`,
        '--',
        options.pathspec,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch (e: unknown) {
    const stderr =
      typeof e === 'object' && e !== null && 'stderr' in e
        ? String((e as { stderr?: unknown }).stderr ?? '')
        : '';
    if (
      /unknown revision|bad revision|ambiguous argument/i.test(stderr)
    ) {
      return err({ kind: 'bad-ref' });
    }
    return err({ kind: 'git-io' });
  }

  const commits = stdout
    .split(RECORD_SEP)
    .map((rec) => rec.replace(/^\n/, ''))
    .filter((rec) => rec.length > 0)
    .map((rec): CommitEntry => {
      const [sha, subject, authorName, authorDate, parents] =
        rec.split(FIELD_SEP);
      return {
        sha: sha ?? '',
        shortSha: (sha ?? '').slice(0, 7),
        subject: subject ?? '',
        authorName: authorName ?? '',
        authorDate: authorDate ?? '',
        parents:
          parents !== undefined && parents.length > 0
            ? parents.split(' ')
            : [],
      };
    });

  return ok({ commits, nextBefore: null });
}
