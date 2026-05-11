/**
 * Whitelist of absolute paths the snippet endpoint is allowed to read,
 * populated from the loader's actually-opened-file set. Refreshed atomically
 * on every materialized resolution (boot and watcher rebuild) so requests in
 * flight either see the previous set or the new one — never a half-built one.
 *
 * The atomicity contract is enforced by a single-assignment swap of the
 * internal `Set` reference inside {@link update}; never mutate that set in
 * place.
 */
export class SnippetAllowList {
  private files: ReadonlySet<string> = new Set<string>();

  has(absPath: string): boolean {
    return this.files.has(absPath);
  }

  update(paths: ReadonlyArray<string>): void {
    this.files = new Set<string>(paths);
  }

  all(): string[] {
    return [...this.files];
  }
}
