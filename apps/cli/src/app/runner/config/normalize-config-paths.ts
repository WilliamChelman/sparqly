import { isAbsolute, resolve } from 'node:path';

export function normalizeConfigPaths(
  parsed: Record<string, unknown>,
  configDir: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parsed };
  const cache = parsed.cache;
  if (cache !== null && typeof cache === 'object' && !Array.isArray(cache)) {
    const cacheObj = cache as Record<string, unknown>;
    if (typeof cacheObj.dir === 'string') {
      out.cache = { ...cacheObj, dir: absolutize(cacheObj.dir, configDir) };
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
