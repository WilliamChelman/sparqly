import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RefEntry, RefsResponse } from './refs-response';

const execFileAsync = promisify(execFile);

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
const FOR_EACH_REF_FORMAT = [
  '%(refname)',
  '%(objectname)',
  '%(objecttype)',
  '%(*objectname)',
].join(FIELD_SEP);

interface RawRef {
  refname: string;
  objectname: string;
  objecttype: string;
  peeled: string;
}

async function gitExec(
  repoRoot: string,
  args: ReadonlyArray<string>,
): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return { stdout, code: 0 };
  } catch (e: unknown) {
    const err = e as { code?: number; stdout?: string };
    return { stdout: err.stdout ?? '', code: err.code ?? 1 };
  }
}

async function readForEachRef(repoRoot: string): Promise<RawRef[]> {
  const { stdout } = await gitExec(repoRoot, [
    'for-each-ref',
    `--format=${FOR_EACH_REF_FORMAT}${RECORD_SEP}`,
  ]);
  return stdout
    .split(RECORD_SEP)
    .map((rec) => rec.replace(/^\n/, ''))
    .filter((rec) => rec.length > 0)
    .map((rec) => {
      const [refname, objectname, objecttype, peeled] = rec.split(FIELD_SEP);
      return {
        refname: refname ?? '',
        objectname: objectname ?? '',
        objecttype: objecttype ?? '',
        peeled: peeled ?? '',
      };
    });
}

async function readHead(
  repoRoot: string,
  raw: RawRef[],
): Promise<RefEntry> {
  const symbolic = await gitExec(repoRoot, [
    'symbolic-ref',
    '--quiet',
    'HEAD',
  ]);
  if (symbolic.code === 0) {
    const target = symbolic.stdout.trim();
    const branch = raw.find((r) => r.refname === target);
    if (branch !== undefined) {
      return { ref: 'HEAD', sha: branch.objectname, kind: 'head' };
    }
  }
  const rev = await gitExec(repoRoot, ['rev-parse', 'HEAD']);
  return { ref: 'HEAD', sha: rev.stdout.trim(), kind: 'head' };
}

function classifyBranches(raw: RawRef[]): RefEntry[] {
  const out: RefEntry[] = [];
  for (const r of raw) {
    if (!r.refname.startsWith('refs/heads/')) continue;
    out.push({
      ref: r.refname.slice('refs/heads/'.length),
      sha: r.objectname,
      kind: 'branch',
    });
  }
  return out;
}

function classifyRemoteBranches(raw: RawRef[]): RefEntry[] {
  const out: RefEntry[] = [];
  const prefix = 'refs/remotes/';
  for (const r of raw) {
    if (!r.refname.startsWith(prefix)) continue;
    const rest = r.refname.slice(prefix.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash <= 0) continue;
    const remote = rest.slice(0, firstSlash);
    const branch = rest.slice(firstSlash + 1);
    out.push({
      ref: `${remote}/${branch}`,
      sha: r.objectname,
      kind: branch === 'HEAD' ? 'remote-head' : 'remote-branch',
      remote,
    });
  }
  return out;
}

function classifyTags(raw: RawRef[]): RefEntry[] {
  const out: RefEntry[] = [];
  for (const r of raw) {
    if (!r.refname.startsWith('refs/tags/')) continue;
    const annotated = r.objecttype === 'tag';
    out.push({
      ref: r.refname.slice('refs/tags/'.length),
      sha: annotated ? r.peeled : r.objectname,
      kind: annotated ? 'tag-annotated' : 'tag-lightweight',
    });
  }
  return out;
}

export async function listRefs(repoRoot: string): Promise<RefsResponse> {
  const raw = await readForEachRef(repoRoot);
  const head = await readHead(repoRoot, raw);
  return {
    head,
    branches: classifyBranches(raw),
    remoteBranches: classifyRemoteBranches(raw),
    tags: classifyTags(raw),
  };
}
