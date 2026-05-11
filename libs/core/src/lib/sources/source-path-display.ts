import { fileURLToPath } from 'node:url';
import { relative as pathRelative } from 'node:path';

export interface DisplayedSourcePath {
  absolutePath: string;
  displayPath: string;
}

/**
 * Decode a `file://` IRI to its absolute filesystem path, and produce a path
 * for display relative to `cwd`. Used by every diff format that surfaces
 * **Source records** so that paths printed to the terminal stay short and
 * navigable. When the file is outside `cwd` the display path uses leading
 * `..` segments — that is `path.relative`'s normal output and remains a
 * valid relative path.
 */
export function displaySourcePath(
  fileIri: string,
  cwd: string,
): DisplayedSourcePath {
  const absolutePath = fileURLToPath(fileIri);
  const displayPath = pathRelative(cwd, absolutePath);
  return { absolutePath, displayPath };
}
