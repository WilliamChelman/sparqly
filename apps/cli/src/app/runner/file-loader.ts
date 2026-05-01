import { ConfigError } from '../config/internal/errors';
import { loadFileConfig } from '../config/internal/file-config';
import type { FileLayers } from './runner';

export type BlockKey = 'query' | 'serve' | 'hash' | 'diff' | 'format';

export function makeFileLoader(commandName: BlockKey) {
  return async (
    configPath: string | undefined,
    cwd: string,
  ): Promise<FileLayers> => {
    try {
      const file = await loadFileConfig({ cwd, configPath });
      return {
        fileTop: file.shared,
        fileBlock: file.blocks[commandName] ?? {},
        filepath: file.filepath,
      };
    } catch (err) {
      if (err instanceof ConfigError) {
        const wrapped = new Error(err.message);
        throw wrapped;
      }
      throw err;
    }
  };
}
