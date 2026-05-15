/**
 * Narrow port for git operations the source loader depends on (ADR-0029).
 * Production wires a `git`-CLI shell-out (see `git-cli-port.ts`); tests inject
 * stubs so unit tests stay filesystem- and process-free.
 */
export interface GitPort {
  /**
   * Resolves `ref` to a 40-char commit SHA against the repo at `repoRoot`, or
   * returns `null` if the ref is unknown / unresolvable. For an annotated tag,
   * the result is the dereferenced commit SHA, not the tag-object SHA.
   */
  resolveRefToSha(repoRoot: string, ref: string): Promise<string | null>;
  /**
   * Returns the git-object type for `ref` (`'tag'` for an annotated tag,
   * `'commit'` for commits, branches, `HEAD`, `HEAD~n`, and lightweight tags),
   * or `null` if the ref is unknown. Used by the resolver to distinguish
   * pinned refs (annotated tags) from floating refs (lightweight tags,
   * branches, `HEAD`).
   */
  getRefObjectType(
    repoRoot: string,
    ref: string,
  ): Promise<'tag' | 'commit' | 'tree' | 'blob' | null>;
  /**
   * Reads the file content at `repoRelPath` from the git tree at `sha`.
   * Returns `null` if the path is absent at that revision. The returned bytes
   * are the raw file content (not text-decoded).
   */
  readFileAtSha(
    repoRoot: string,
    sha: string,
    repoRelPath: string,
  ): Promise<Buffer | null>;
  /**
   * Lists every blob path in the git tree at `sha`, as repo-relative paths
   * with forward-slash separators (the `git ls-tree -r --name-only` shape).
   * Used by the split-glob git-tree walker (ADR-0029) to enumerate files at
   * a pinned revision instead of the working tree.
   */
  listFilesAtSha(repoRoot: string, sha: string): Promise<ReadonlyArray<string>>;
}
