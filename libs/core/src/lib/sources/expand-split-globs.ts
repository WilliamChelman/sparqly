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
   * Boundary logger for the zero-match `warn` line (ADR-0028). Defaults to
   * no-op so non-CLI callers stay silent.
   */
  logger?: SparqlyLogger;
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
 * globs emit a single `warn` and yield meta + no children.
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
    const children = await expandOne(src, deps.walkGlob, logger);
    for (const child of children) out.push(child);
  }
  return out;
}

async function expandOne(
  meta: ParsedGlobSource,
  walkGlob: ExpandSplitGlobsDeps['walkGlob'],
  logger: SparqlyLogger,
): Promise<ReadonlyArray<ParsedFileSource>> {
  if (meta.id === undefined) {
    throw new Error(
      `splitByFile: true requires an \`id\` on the glob source (glob ${JSON.stringify(meta.glob)})`,
    );
  }
  const parentId = meta.id;
  const files = await walkGlob(meta.glob);
  if (files.length === 0) {
    logger.warn(
      `No files matched split-glob ${meta.glob} for source ${parentId}`,
      { glob: meta.glob, parentId },
    );
    return [];
  }
  return files.map((file) => synthesizeChild(meta, parentId, file));
}

function synthesizeChild(
  meta: ParsedGlobSource,
  parentId: string,
  absoluteFilePath: string,
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
  validateSynthesizedFileSource(child);
  return child;
}
