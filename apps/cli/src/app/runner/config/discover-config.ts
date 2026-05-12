import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CONFIG_BASENAMES = [
  'sparqly.config.yaml',
  'sparqly.config.yml',
  'sparqly.config.json',
] as const;

export interface DiscoverConfigOptions {
  readonly cwd: string;
}

export class MultipleConfigsError extends Error {
  constructor(directory: string, matches: ReadonlyArray<string>) {
    super(
      `multiple sparqly config files found in ${directory}: ${matches.join(', ')} — keep only one`,
    );
    this.name = 'MultipleConfigsError';
  }
}

export function discoverConfig(opts: DiscoverConfigOptions): string | null {
  let dir = opts.cwd;
  while (true) {
    const matches = CONFIG_BASENAMES.filter((base) =>
      existsSync(join(dir, base)),
    );
    if (matches.length > 1) throw new MultipleConfigsError(dir, matches);
    if (matches.length === 1) return join(dir, matches[0]);
    if (existsSync(join(dir, '.git'))) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
