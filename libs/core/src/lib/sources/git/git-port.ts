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
   * Reads the file content at `repoRelPath` from the git tree at `sha`.
   * Returns `null` if the path is absent at that revision. The returned bytes
   * are the raw file content (not text-decoded).
   */
  readFileAtSha(
    repoRoot: string,
    sha: string,
    repoRelPath: string,
  ): Promise<Buffer | null>;
}
