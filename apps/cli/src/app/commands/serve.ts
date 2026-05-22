import { join } from 'node:path';
import { z } from 'zod';
import type { SourceSpecInput } from 'core';
import { createServer } from 'server';
import { configureLogger } from '../logging';
import { printServeSplash } from './serve-splash';
import { makeSpawnIndexBuild } from './serve-index-spawn';
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
  watchPoll?: number;
  prefixes?: Record<string, string>;
  base?: string;
  perSourceSoftLimit?: number;
  perSourceHardLimit?: number;
  fromSourcePredicate?: string;
  savedQueriesPath?: string;
  indexCacheDir?: string;
  indexConcurrency?: number;
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
        'Refuse writes to the saved-query sidecar. PUT/DELETE return 405 and the webapp hides Save / Save-as / Delete affordances. Default: writes allowed.',
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
        "Watch the target's chain (globs and any `cache.ttl`/`cache.freshness` views) and rebuild on change. Default: off.",
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

const watchPollField: FieldDescriptor = {
  key: 'watchPoll',
  schema: coercedIntSchema,
  default: 1000,
  flags: [
    {
      spec: '--watch-poll <ms>',
      description:
        'Poll interval for cache freshness ASK probes under --watch in milliseconds (default: 1000)',
    },
  ],
};

// Registry-wide describe defaults, read from the top-level `describe:` block
// (see `describeBlockSchema`). No CLI flags — these are deployment knobs.
const describeSoftLimitField: FieldDescriptor = {
  key: 'perSourceSoftLimit',
  schema: z.number().int().positive(),
};

const describeHardLimitField: FieldDescriptor = {
  key: 'perSourceHardLimit',
  schema: z.number().int().positive(),
};

const describeFromSourcePredicateField: FieldDescriptor = {
  key: 'fromSourcePredicate',
  schema: z.string().min(1),
};

// Saved-query sidecar path, read from the top-level `savedQueries.path` config
// block (ADR-0036). No CLI flag — saved-query state is project-shaped, not
// per-invocation.
const savedQueriesPathField: FieldDescriptor = {
  key: 'savedQueriesPath',
  schema: z.string().min(1),
};

// Glob index cache root, read from the top-level `index.dir` config block
// (ADR-0041, #345). No CLI flag — where disk-backed indexes live is a
// project-shaped deployment knob, not a per-invocation choice.
const indexCacheDirField: FieldDescriptor = {
  key: 'indexCacheDir',
  schema: z.string().min(1),
};

// Capped child-process index-build concurrency, read from the top-level
// `index.concurrency` config block (ADR-0042, #350). No CLI flag — a
// deployment-shaped knob. `EngineMap` defaults it to 2 when omitted.
const indexConcurrencyField: FieldDescriptor = {
  key: 'indexConcurrency',
  schema: z.number().int().positive(),
};

export const serveSpec: CommandSpec<ServeConfig> = {
  name: 'serve',
  description:
    'Serve a W3C SPARQL Protocol endpoint. Exposes /api/sparql/<id> for every non-`reference` source, /api/sparql as an alias for the default source, plus /api/diff, /api/describe, /api/source-snippet, /api/config and the web playground. Pass a positional glob/URL or --source @id to scope the served set to one source (its `from:` deps stay resolvable but unlisted). Intended for single-user development; not hardened for concurrent users.',
  fields: [
    sourceField,
    sourcesRegistryField,
    portField,
    ...mutableFieldsFor('serve'),
    readOnlyField,
    watchField,
    watchDebounceField,
    watchPollField,
    contextPrefixesField,
    contextBaseField,
    describeSoftLimitField,
    describeHardLimitField,
    describeFromSourcePredicateField,
    savedQueriesPathField,
    indexCacheDirField,
    indexConcurrencyField,
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

    if (sources.length === 0 && scope === undefined) {
      throw new Error(
        'No sources configured. Pass a positional/--source, or define `sources:` in your config.',
      );
    }

    // `main.ts` overwrites `process.argv[1]` with the bare program name, so the
    // CLI entry a build child must re-invoke is read from `require.main`.
    const cliEntry = require.main?.filename ?? __filename;

    const created = await createServer({
      sources,
      scope,
      port,
      mutable,
      readOnly: config.readOnly === true,
      webRootDir: WEB_BUNDLE_DIR,
      watch: config.watch === true,
      watchDebounceMs: config.watchDebounce,
      watchPollMs: config.watchPoll,
      context: {
        prefixes: config.prefixes ?? {},
        base: config.base,
      },
      describe: {
        perSourceSoftLimit: config.perSourceSoftLimit,
        perSourceHardLimit: config.perSourceHardLimit,
        fromSourcePredicate: config.fromSourcePredicate,
      },
      savedQueriesPath: config.savedQueriesPath,
      indexCacheDir: config.indexCacheDir,
      indexConcurrency: config.indexConcurrency,
      spawnIndexBuild: makeSpawnIndexBuild({ cliEntry }),
      logger: boundaryLog,
    });

    // Graceful shutdown (ADR-0042): SIGTERM any in-flight `sparqly index` build
    // children and release the embedded index locks before exiting. A second
    // Ctrl-C falls through to Node's default and hard-kills instantly.
    const shutdown = (): void => {
      void created.close().then(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  },
};
