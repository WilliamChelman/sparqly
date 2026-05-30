import { isAbsolute, resolve } from 'node:path';

export function normalizeConfigPaths(
  parsed: Record<string, unknown>,
  configDir: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parsed };
  // The Glob index cache root (`index.dir`) carries a `dir` resolved against
  // the project config dir.
  for (const blockName of ['index'] as const) {
    const block = parsed[blockName];
    if (block === null || typeof block !== 'object' || Array.isArray(block)) {
      continue;
    }
    const blockObj = block as Record<string, unknown>;
    if (typeof blockObj.dir === 'string') {
      out[blockName] = { ...blockObj, dir: absolutize(blockObj.dir, configDir) };
    }
  }
  if (Array.isArray(parsed.sources)) {
    out.sources = parsed.sources.map((entry) =>
      normalizeSourceEntry(entry, configDir),
    );
  }
  return out;
}

function normalizeSourceEntry(entry: unknown, configDir: string): unknown {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return entry;
  }
  const obj = entry as Record<string, unknown>;
  const next: Record<string, unknown> = { ...obj };
  if (typeof obj.glob === 'string') {
    next.glob = absolutize(obj.glob, configDir);
  }
  if (typeof obj.queryFile === 'string') {
    next.queryFile = absolutize(obj.queryFile, configDir);
  }
  return next;
}

function absolutize(p: string, configDir: string): string {
  return isAbsolute(p) ? p : resolve(configDir, p);
}
