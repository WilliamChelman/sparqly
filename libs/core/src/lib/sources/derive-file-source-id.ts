import { posix } from 'node:path';

const WILDCARD_RE = /[*?[{]/;

/**
 * Synthesize a stable id for one file matched by a split-glob meta.
 *
 * The child id is `<parentId>/<glob-relative-path>` — the file path relative
 * to the glob's static prefix (the directory portion before the first
 * wildcard character). Stable across enumeration order; depends only on
 * inputs (ADR-0027).
 */
export function deriveFileSourceId(
  parentId: string,
  globPattern: string,
  absoluteFilePath: string,
): string {
  const staticPrefix = computeStaticPrefix(globPattern);
  if (staticPrefix === '') {
    return `${parentId}/${posix.basename(absoluteFilePath)}`;
  }
  const needle = `/${staticPrefix}/`;
  const idx = absoluteFilePath.lastIndexOf(needle);
  if (idx === -1) {
    return `${parentId}/${posix.basename(absoluteFilePath)}`;
  }
  const rest = absoluteFilePath.slice(idx + needle.length);
  return `${parentId}/${rest}`;
}

function computeStaticPrefix(globPattern: string): string {
  const wildcardIdx = globPattern.search(WILDCARD_RE);
  if (wildcardIdx === -1) {
    const dir = posix.dirname(globPattern);
    return dir === '.' || dir === '/' ? '' : trimSlashes(dir);
  }
  const beforeWildcard = globPattern.slice(0, wildcardIdx);
  const lastSep = beforeWildcard.lastIndexOf('/');
  if (lastSep === -1) return '';
  return trimSlashes(beforeWildcard.slice(0, lastSep));
}

function trimSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, '');
}
