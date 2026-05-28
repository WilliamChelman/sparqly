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
  readonly before?: string;
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
  // When `before` is provided, walk from its parents (`<sha>^@`) — the
  // scope's reachability is implicit because we already surfaced `before`
  // from that scope on the prior page. Cursor-based, so interleaving calls
  // can't shift the page boundaries.
  const scopeArgs =
    options.before !== undefined
      ? [`${options.before}^@`]
      : options.ref === '__all__'
        ? ['--all']
        : [options.ref];
  // Over-fetch by one to detect whether more pages remain without a second
  // shell-out.
  const fetchCount = options.limit + 1;
  let stdout: string;
  try {
    const result = await execFileAsync(
      'git',
      [
        '-C',
        repoRoot,
        'log',
        ...scopeArgs,
        `--max-count=${fetchCount}`,
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

  const allCommits = stdout
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

  const hasMore = allCommits.length > options.limit;
  const commits = hasMore ? allCommits.slice(0, options.limit) : allCommits;
  const nextBefore =
    hasMore && commits.length > 0 ? commits[commits.length - 1].sha : null;

  return ok({ commits, nextBefore });
}
