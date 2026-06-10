import { join } from 'node:path';
import { z } from 'zod';
import { formatTargetError, type SourceSpecInput } from 'core';
import { createServer } from 'server';
import { configureLogger } from '../logging';
import { printServeSplash } from './serve-splash';
import { makeSpawnIndexBuild } from './serve-index-spawn';
import { makeSpawnQueryWorker } from './serve-query-worker-spawn';
import { makeShutdownHandler } from './serve-shutdown';
import type { FieldDescriptor } from '../runner/fields/field';
import {
  coercedBooleanSchema,
  coercedIntSchema,
  contextBaseField,
  contextPrefixesField,
  mutableFieldsFor,
  sourceField,
  verbosityFieldsFor,
} from '../runner/fields/fields-shared';
import type { CommandSpec } from '../runner/fields/spec';

const WEB_BUNDLE_DIR = join(__dirname, 'web');

interface ServeConfig {
  sources?: SourceSpecInput[];
  source?: SourceSpecInput;
  port?: number;
  mutable?: boolean;
  readOnly?: boolean;
  watch?: boolean;
  watchDebounce?: number;
  prefixes?: Record<string, string>;
  base?: string;
  perSourceSoftLimit?: number;
  perSourceHardLimit?: number;
  savedQueriesPath?: string;
  indexCacheDir?: string;
  indexConcurrency?: number;
  queryConcurrency?: number;
  queryMaxResidentQuads?: number;
  queryCancelGraceMs?: number;
  queryMaxOldGenerationSizeMb?: number;
  queryCacheMaxBytes?: number | null;
  queryCacheMaxEntryBytes?: number;
  verbose?: boolean;
  quiet?: boolean;
  logFormat?: 'text' | 'json';
}

const sourceSpecObjectSchema = z.record(z.string(), z.unknown());

const sourcesRegistryField: FieldDescriptor = {
  key: 'sources',
  schema: z.array(z.union([z.string(), sourceSpecObjectSchema])),
};

const portField: FieldDescriptor = {
  key: 'port',
  schema: coercedIntSchema,
  default: 3000,
  env: ['SPARQLY_PORT'],
  flags: [
    {
      spec: '-p, --port <port>',
      description: 'HTTP port (default: 3000)',
    },
  ],
};

const readOnlyField: FieldDescriptor = {
  key: 'readOnly',
  schema: coercedBooleanSchema,
  default: false,
  flags: [
    {
      spec: '--read-only',
      description:
        'Refuse writes to the saved-query sidecar (PUT/DELETE return 405) AND refuse Sources page admin actions — Load / Reload / Unload routes return 403. The webapp hides both the saved-query write affordances and the per-row Sources actions. Default: writes and admin actions allowed.',
    },
  ],
};

const watchField: FieldDescriptor = {
  key: 'watch',
  schema: coercedBooleanSchema,
  default: false,
  flags: [
    {
      spec: '--watch',
      description:
        "Watch the served sources' glob/file inputs and rebuild on change. Default: off.",
    },
  ],
};

const watchDebounceField: FieldDescriptor = {
  key: 'watchDebounce',
  schema: coercedIntSchema,
  default: 250,
  flags: [
    {
      spec: '--watch-debounce <ms>',
      description: 'Debounce window for --watch in milliseconds (default: 250)',
    },
  ],
};

const describeSoftLimitField: FieldDescriptor = {
  key: 'perSourceSoftLimit',
  schema: z.number().int().positive(),
};

const describeHardLimitField: FieldDescriptor = {
  key: 'perSourceHardLimit',
  schema: z.number().int().positive(),
};

const savedQueriesPathField: FieldDescriptor = {
  key: 'savedQueriesPath',
  schema: z.string().min(1),
};

const indexCacheDirField: FieldDescriptor = {
  key: 'indexCacheDir',
  schema: z.string().min(1),
};

const indexConcurrencyField: FieldDescriptor = {
  key: 'indexConcurrency',
  schema: z.number().int().positive(),
};

const queryConcurrencyField: FieldDescriptor = {
  key: 'queryConcurrency',
  schema: z.number().int().positive(),
};

const queryMaxResidentQuadsField: FieldDescriptor = {
  key: 'queryMaxResidentQuads',
  schema: z.number().int().positive(),
};

const queryCancelGraceMsField: FieldDescriptor = {
  key: 'queryCancelGraceMs',
  schema: z.number().int().positive(),
};

const queryMaxOldGenerationSizeMbField: FieldDescriptor = {
  key: 'queryMaxOldGenerationSizeMb',
  schema: z.number().int().positive(),
};

// Query cache global budget from the top-level `queryCache` block (already
// resolved to bytes by the project-config schema). `null` = explicitly unbounded.
const queryCacheMaxBytesField: FieldDescriptor = {
  key: 'queryCacheMaxBytes',
  schema: z.union([z.number().int().positive(), z.null()]),
};

const queryCacheMaxEntryBytesField: FieldDescriptor = {
  key: 'queryCacheMaxEntryBytes',
  schema: z.number().int().positive(),
};

export const serveSpec: CommandSpec<ServeConfig> = {
  name: 'serve',
  description:
    'Serve a W3C SPARQL Protocol endpoint. Exposes /api/sparql/<id> for every non-`reference` source, /api/sparql as an alias for the default source, plus /api/diff, /api/describe, /api/source-snippet, /api/config and the web playground. Pass a positional glob/URL or --source @id to scope the served set to one source. Intended for single-user development; not hardened for concurrent users.',
  fields: [
    sourceField,
    sourcesRegistryField,
    portField,
    ...mutableFieldsFor('serve'),
    readOnlyField,
    watchField,
    watchDebounceField,
    contextPrefixesField,
    contextBaseField,
    describeSoftLimitField,
    describeHardLimitField,
    savedQueriesPathField,
    indexCacheDirField,
    indexConcurrencyField,
    queryConcurrencyField,
    queryMaxResidentQuadsField,
    queryCancelGraceMsField,
    queryMaxOldGenerationSizeMbField,
    queryCacheMaxBytesField,
    queryCacheMaxEntryBytesField,
    ...verbosityFieldsFor('serve'),
  ],
  positionals: [{ field: 'source', name: 'glob' }],
  configScope: { sources: true, block: 'serve' },
  exitCode: () => 1,
  handler: async (config) => {
    const boundaryLog = configureLogger({
      verbose: config.verbose === true,
      quiet: config.quiet === true,
      logFormat: config.logFormat,
    });
    printServeSplash({ quiet: config.quiet === true });

    const port = config.port ?? 3000;
    const mutable = config.mutable === true;

    let sources: ReadonlyArray<SourceSpecInput>;
    let scope: string | undefined;
    if (typeof config.source === 'object' && config.source !== null) {
      // Inline object spec replaces the configured registry; served as @default.
      sources = [config.source];
      scope = undefined;
    } else {
      sources = config.sources ?? [];
      scope = typeof config.source === 'string' ? config.source : undefined;
    }

    // `main.ts` overwrites `process.argv[1]` with the bare program name.
    const cliEntry = require.main?.filename ?? __filename;

    const result = await createServer({
      sources,
      scope,
      port,
      mutable,
      readOnly: config.readOnly === true,
      webRootDir: WEB_BUNDLE_DIR,
      watch: config.watch === true,
      watchDebounceMs: config.watchDebounce,
      context: {
        prefixes: config.prefixes ?? {},
        base: config.base,
      },
      describe: {
        perSourceSoftLimit: config.perSourceSoftLimit,
        perSourceHardLimit: config.perSourceHardLimit,
      },
      savedQueriesPath: config.savedQueriesPath,
      indexCacheDir: config.indexCacheDir,
      indexConcurrency: config.indexConcurrency,
      queryConcurrency: config.queryConcurrency,
      queryCancelGraceMs: config.queryCancelGraceMs,
      queryCacheMaxBytes: config.queryCacheMaxBytes,
      queryCacheMaxEntryBytes: config.queryCacheMaxEntryBytes,
      spawnIndexBuild: makeSpawnIndexBuild({ cliEntry }),
      spawnQueryWorker: makeSpawnQueryWorker({
        cliEntry,
        maxResidentQuads: config.queryMaxResidentQuads,
        maxOldGenerationSizeMb: config.queryMaxOldGenerationSizeMb,
      }),
      logger: boundaryLog,
    });

    result.match(
      (created) => {
        const shutdown = makeShutdownHandler({
          close: () => created.close(),
          exit: (code) => process.exit(code),
          logger: boundaryLog,
        });
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
      },
      (error) => {
        process.stderr.write(`error: ${formatTargetError(error)}\n`);
        process.exit(1);
      },
    );
  },
};
