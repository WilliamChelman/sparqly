import { glob as tinyglob } from 'tinyglobby';
import { noopLogger, type SparqlyLogger } from 'common';
import { deriveFileSourceId } from './derive-file-source-id';
import {
  validateSynthesizedFileSource,
  type ParsedFileSource,
  type ParsedGlobSource,
  type ParsedSource,
} from './source-spec';

export interface ExpandSplitGlobsDeps {
  /** Injectable so tests stay filesystem-free; production uses {@link defaultGlobWalker}. */
  walkGlob: (pattern: string) => Promise<ReadonlyArray<string>>;
  /** Required when any split-glob meta carries `gitRef:`. */
  walkGitGlob?: (meta: ParsedGlobSource) => Promise<PinnedSplitGlobWalkResult>;
  /** Boundary logger for the zero-match warn line; defaults to no-op. */
  logger?: SparqlyLogger;
}

export interface PinnedSplitGlobWalkResult {
  /** Absolute matched paths under {@link repoRoot}. */
  files: ReadonlyArray<string>;
  /** Repo root discovered for the parent glob. */
  repoRoot: string;
  /** User-facing ref the parent declared. */
  ref: string;
  /** Resolved 40-char commit SHA. */
  resolvedSha: string;
}

export async function defaultGlobWalker(
  pattern: string,
): Promise<ReadonlyArray<string>> {
  return tinyglob(pattern, { absolute: true });
}

/**
 * Synthesizes one `kind: 'file'` child per matched file alongside each
 * `splitByFile: true` meta. Non-split entries pass through. Zero-match metas
 * `warn` and yield no children. Pinned metas walk the git tree at the
 * resolved SHA via {@link ExpandSplitGlobsDeps.walkGitGlob}.
 */
export async function expandSplitGlobs(
  parsed: ReadonlyArray<ParsedSource>,
  deps: ExpandSplitGlobsDeps,
): Promise<ReadonlyArray<ParsedSource>> {
  const logger = deps.logger ?? noopLogger;
  const out: ParsedSource[] = [];
  for (const src of parsed) {
    if (src.kind !== 'glob' || src.splitByFile !== true) {
      out.push(src);
      continue;
    }
    out.push(src);
    const children =
      src.gitRef !== undefined
        ? await expandPinned(src, deps.walkGitGlob, logger)
        : await expandWorkingTree(src, deps.walkGlob, logger);
    for (const child of children) out.push(child);
  }
  return out;
}

async function expandWorkingTree(
  meta: ParsedGlobSource,
  walkGlob: ExpandSplitGlobsDeps['walkGlob'],
  logger: SparqlyLogger,
): Promise<ReadonlyArray<ParsedFileSource>> {
  const parentId = requireParentId(meta);
  const files = await walkGlob(meta.glob);
  if (files.length === 0) {
    warnEmpty(logger, meta.glob, parentId);
    return [];
  }
  return files.map((file) => synthesizeChild(meta, parentId, file));
}

async function expandPinned(
  meta: ParsedGlobSource,
  walkGitGlob: ExpandSplitGlobsDeps['walkGitGlob'],
  logger: SparqlyLogger,
): Promise<ReadonlyArray<ParsedFileSource>> {
  const parentId = requireParentId(meta);
  if (walkGitGlob === undefined) {
    throw new Error(
      `expandSplitGlobs: split-glob ${JSON.stringify(meta.glob)} declares \`gitRef:\` but no walkGitGlob dep was wired; pass one at the boundary that constructs the registry`,
    );
  }
  const walked = await walkGitGlob(meta);
  if (walked.files.length === 0) {
    warnEmpty(logger, meta.glob, parentId);
    return [];
  }
  return walked.files.map((file) =>
    synthesizeChild(meta, parentId, file, {
      gitRef: walked.ref,
      repoRoot: walked.repoRoot,
      resolvedSha: walked.resolvedSha,
    }),
  );
}

function warnEmpty(
  logger: SparqlyLogger,
  glob: string,
  parentId: string,
): void {
  logger.warn(`No files matched split-glob ${glob} for source ${parentId}`, {
    glob,
    parentId,
  });
}

function requireParentId(meta: ParsedGlobSource): string {
  if (meta.id === undefined) {
    throw new Error(
      `splitByFile: true requires an \`id\` on the glob source (glob ${JSON.stringify(meta.glob)})`,
    );
  }
  return meta.id;
}

interface PinInheritance {
  gitRef: string;
  repoRoot: string;
  resolvedSha: string;
}

function synthesizeChild(
  meta: ParsedGlobSource,
  parentId: string,
  absoluteFilePath: string,
  pin?: PinInheritance,
): ParsedFileSource {
  const child: ParsedFileSource = {
    kind: 'file',
    id: deriveFileSourceId(parentId, meta.glob, absoluteFilePath),
    path: absoluteFilePath,
    parentId,
  };
  if (meta.transforms !== undefined) {
    child.transforms = meta.transforms.map((t) => ({ ...t }));
  }
  if (meta.unionDefaultGraph !== undefined) {
    child.unionDefaultGraph = meta.unionDefaultGraph;
  }
  if (meta.storage !== undefined) {
    child.storage = meta.storage;
  }
  if (meta.queryCache !== undefined) {
    child.queryCache = meta.queryCache;
  }
  if (pin !== undefined) {
    child.gitRef = pin.gitRef;
    child.repoRoot = pin.repoRoot;
    child.resolvedSha = pin.resolvedSha;
  }
  validateSynthesizedFileSource(child);
  return child;
}
