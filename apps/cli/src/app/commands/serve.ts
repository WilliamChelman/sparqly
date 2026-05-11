import { join } from 'node:path';
import { z } from 'zod';
import {
  parseSourceSpecs,
  selectTarget,
  type ParsedSource,
  type SourceSpecInput,
} from 'core';
import { createServer } from 'server';
import { configureLogger } from '../logging';
import { printServeSplash } from './serve-splash';
import type { FieldDescriptor } from '../runner/field';
import {
  coercedBooleanSchema,
  coercedIntSchema,
  contextBaseField,
  contextPrefixesField,
  mutableFieldsFor,
  sourceField,
  verbosityFieldsFor,
} from '../runner/fields-shared';
import type { CommandSpec } from '../runner/spec';

const WEB_BUNDLE_DIR = join(__dirname, 'web');

interface ServeConfig {
  sources?: SourceSpecInput[];
  source?: SourceSpecInput;
  port?: number;
  mutable?: boolean;
  watch?: boolean;
  watchDebounce?: number;
  watchPoll?: number;
  prefixes?: Record<string, string>;
  base?: string;
  perSourceSoftLimit?: number;
  perSourceHardLimit?: number;
  fromSourcePredicate?: string;
  verbose?: boolean;
  quiet?: boolean;
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

export function resolveServeTarget(config: ServeConfig): ParsedSource {
  const registry = parseSourceSpecs(config.sources ?? []);
  const targetArg =
    typeof config.source === 'string' ? config.source : undefined;
  if (config.source !== undefined && targetArg === undefined) {
    return parseSourceSpecs([config.source])[0];
  }
  return selectTarget(registry, targetArg);
}

export const serveSpec: CommandSpec<ServeConfig> = {
  name: 'serve',
  description:
    'Serve a W3C SPARQL Protocol endpoint. With no positional/--source, boots in Registry mode and exposes /api/sparql/<id> for every non-`reference` source plus /api/config. With a positional or --source, boots in Single-source mode and exposes /api/sparql against that target. Intended for single-user development; not hardened for concurrent users.',
  fields: [
    sourceField,
    sourcesRegistryField,
    portField,
    ...mutableFieldsFor('serve'),
    watchField,
    watchDebounceField,
    watchPollField,
    contextPrefixesField,
    contextBaseField,
    describeSoftLimitField,
    describeHardLimitField,
    describeFromSourcePredicateField,
    ...verbosityFieldsFor('serve'),
  ],
  positionals: [{ field: 'source', name: 'glob' }],
  configScope: { sources: true, block: 'serve' },
  exitCode: () => 1,
  handler: async (config) => {
    configureLogger({
      verbose: config.verbose === true,
      quiet: config.quiet === true,
    });
    printServeSplash({ quiet: config.quiet === true });

    const port = config.port ?? 3000;
    const mutable = config.mutable === true;

    let sources: ReadonlyArray<SourceSpecInput>;
    let target: string | undefined;
    if (typeof config.source === 'object' && config.source !== null) {
      // Inline object spec overrides the registry — single-source registry.
      sources = [config.source];
      target = undefined;
    } else {
      sources = config.sources ?? [];
      target = typeof config.source === 'string' ? config.source : undefined;
    }

    if (sources.length === 0 && target === undefined) {
      throw new Error(
        'No sources configured. Pass a positional/--source, or define `sources:` in your config to boot in Registry mode.',
      );
    }

    await createServer({
      sources,
      target,
      port,
      mutable,
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
    });
  },
};
