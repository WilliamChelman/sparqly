import { isAbsolute, relative, resolve } from 'node:path';

export type PathspecTarget =
  | { kind: 'glob'; pattern: string; configDir: string; repoRoot: string }
  | { kind: 'file'; path: string; repoRoot: string };

export function translatePathspec(target: PathspecTarget): string {
  if (target.kind === 'glob') {
    const absolute = isAbsolute(target.pattern)
      ? target.pattern
      : resolve(target.configDir, target.pattern);
    const repoRelative = relative(target.repoRoot, absolute);
    return `:(glob,top)${repoRelative}`;
  }
  return relative(target.repoRoot, target.path);
}
