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
  /**
   * Walks the filesystem for one `splitByFile: true` glob and returns its
   * absolute matched file paths. Injectable so tests stay filesystem-free;
   * production wires the same `tinyglobby` shape used by `loadRdfResult` —
   * see {@link defaultGlobWalker}.
   */
  walkGlob: (pattern: string) => Promise<ReadonlyArray<string>>;
  /**
   * Walker invoked when a split-glob meta carries `gitRef:` (ADR-0029).
   * Returns the matched absolute paths from the git tree at the resolved SHA
   * plus the resolution metadata children inherit. Mandatory whenever any
   * pinned split-glob is in the expansion set; the boundary that constructs
   * the registry wires it (production: `defaultGitTreeWalker`).
   */
  walkGitGlob?: (meta: ParsedGlobSource) => Promise<PinnedSplitGlobWalkResult>;
  /**
   * Boundary logger for the zero-match `warn` line (ADR-0028). Defaults to
   * no-op so non-CLI callers stay silent.
   */
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

/**
 * Production walker — the same `tinyglobby` shape used by `loadRdfResult`,
 * returning absolute file paths. Tests inject their own walker through
 * {@link ExpandSplitGlobsDeps.walkGlob}.
 */
export async function defaultGlobWalker(
  pattern: string,
): Promise<ReadonlyArray<string>> {
  return tinyglob(pattern, { absolute: true });
}

/**
 * Walks every `splitByFile: true` glob meta in `parsed` and synthesizes one
 * `kind: 'file'` child per matched file alongside the meta (ADR-0027). Non-split
 * entries pass through unchanged. Returned registry is flat. Zero-match split
 * globs emit a single `warn` and yield meta + no children. When a meta carries
 * `gitRef:` (ADR-0029), enumeration walks the git tree at the resolved SHA
 * (via {@link ExpandSplitGlobsDeps.walkGitGlob}) and children inherit the pin
 * alongside the transform pipeline.
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
      `expandSplitGlobs: split-glob ${JSON.stringify(meta.glob)} declares \`gitRef:\` but no walkGitGlob dep was wired; pass one at the boundary that constructs the registry (ADR-0029)`,
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
  if (pin !== undefined) {
    child.gitRef = pin.gitRef;
    child.repoRoot = pin.repoRoot;
    child.resolvedSha = pin.resolvedSha;
  }
  validateSynthesizedFileSource(child);
  return child;
}
