import { join } from 'node:path';
import { type GraphMode } from 'core';
import { createServer } from 'server';
import { configureLogger } from '../logging';
import type { FieldDescriptor } from '../runner/field';
import {
  coercedBooleanSchema,
  coercedIntSchema,
  graphModeFieldFor,
  mutableFieldsFor,
  sourcesFieldFor,
  verbosityFieldsFor,
} from '../runner/fields-shared';
import type { CommandSpec } from '../runner/spec';

const WEB_BUNDLE_DIR = join(__dirname, 'web');

interface ServeConfig {
  sources?: string | string[];
  port?: number;
  graphMode?: GraphMode;
  mutable?: boolean;
  watch?: boolean;
  watchDebounce?: number;
  verbose?: boolean;
  quiet?: boolean;
}

const portField: FieldDescriptor = {
  key: 'port',
  schema: coercedIntSchema,
  default: 3000,
  env: ['SPARQLY_PORT', 'SPARQLY_SERVE_PORT'],
  flags: [
    {
      spec: '-p, --port <port>',
      description: 'HTTP port (default: 3000)',
    },
  ],
};

const watchField: FieldDescriptor = {
  key: 'watch',
  schema: coercedBooleanSchema,
  default: false,
  env: ['SPARQLY_WATCH', 'SPARQLY_SERVE_WATCH'],
  flags: [
    {
      spec: '--watch',
      description:
        'Watch the sources glob and rebuild the in-memory store on change (debounced). Default: off.',
    },
  ],
};

const watchDebounceField: FieldDescriptor = {
  key: 'watchDebounce',
  schema: coercedIntSchema,
  default: 250,
  env: ['SPARQLY_WATCH_DEBOUNCE', 'SPARQLY_SERVE_WATCH_DEBOUNCE'],
  flags: [
    {
      spec: '--watch-debounce <ms>',
      description: 'Debounce window for --watch in milliseconds (default: 250)',
    },
  ],
};

export const serveSpec: CommandSpec<ServeConfig> = {
  name: 'serve',
  description: 'Serve a W3C SPARQL Protocol endpoint at /api/sparql',
  fields: [
    sourcesFieldFor('serve'),
    portField,
    graphModeFieldFor('serve'),
    ...mutableFieldsFor('serve'),
    watchField,
    watchDebounceField,
    ...verbosityFieldsFor('serve'),
  ],
  positionals: [{ field: 'sources', name: 'glob' }],
  exitCode: () => 1,
  handler: async (config) => {
    configureLogger({
      verbose: config.verbose === true,
      quiet: config.quiet === true,
    });

    if (!config.sources) {
      throw new Error('a sources glob is required');
    }

    const graphMode = config.graphMode;
    const port = config.port ?? 3000;
    const mutable = config.mutable === true;

    await createServer({
      sources: config.sources,
      port,
      mutable,
      graphMode,
      webRootDir: WEB_BUNDLE_DIR,
      watch: config.watch === true,
      watchDebounceMs: config.watchDebounce,
    });
  },
};
