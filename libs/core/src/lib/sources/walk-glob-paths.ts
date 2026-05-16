import type {
  ExpandSplitGlobsDeps,
  PinnedSplitGlobWalkResult,
} from './expand-split-globs';
import type { ParsedGlobSource } from './source-spec';

export interface WalkGlobPathsDeps {
  /** Walks a plain (non-pinned) glob pattern; shape mirrors `expandSplitGlobs`. */
  walkGlob: ExpandSplitGlobsDeps['walkGlob'];
  /** Walks a pinned glob against its git tree. Required when the spec carries `gitRef`. */
  walkGitGlob?: (
    meta: ParsedGlobSource,
  ) => Promise<PinnedSplitGlobWalkResult>;
}

/**
 * Enumerates absolute file paths matched by a glob source spec (split or not,
 * pinned or working-tree) without reading file contents, parsing N3, or
 * running transforms (ADR-0031). Used by `serve` to seed the snippet
 * allow-list at boot before any source's Store is built.
 */
export async function walkGlobPaths(
  source: ParsedGlobSource,
  deps: WalkGlobPathsDeps,
): Promise<ReadonlyArray<string>> {
  if (source.gitRef !== undefined) {
    if (deps.walkGitGlob === undefined) {
      throw new Error(
        `walkGlobPaths: glob ${JSON.stringify(source.glob)} declares \`gitRef:\` but no walkGitGlob dep was wired`,
      );
    }
    const walked = await deps.walkGitGlob(source);
    return walked.files;
  }
  return deps.walkGlob(source.glob);
}
