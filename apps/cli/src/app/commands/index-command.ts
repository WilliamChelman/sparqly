import { z } from 'zod';
import {
  createGitTreeWalker,
  defaultGlobWalker,
  diskBackedIndexIdentity,
  ensureGlobIndex,
  expandSplitGlobs,
  globIndexDir,
  parseSourceSpecs,
  type EnsureGlobIndexOutcome,
  type SourceSpecInput,
} from 'core';
import { cliVersion } from '../cli-version';
import { configureLogger } from '../logging';
import type { FieldDescriptor } from '../runner/fields/field';
import {
  coercedBooleanSchema,
  verbosityFieldsFor,
} from '../runner/fields/fields-shared';
import type { CommandSpec } from '../runner/fields/spec';
import { selectIndexTargets, type IndexTarget } from './select-index-targets';

interface IndexConfig {
  sources?: SourceSpecInput[];
  ids?: string[];
  force?: boolean;
  indexCacheDir?: string;
  verbose?: boolean;
  quiet?: boolean;
  logFormat?: 'text' | 'json';
}

const sourceSpecObjectSchema = z.record(z.string(), z.unknown());

const sourcesRegistryField: FieldDescriptor = {
  key: 'sources',
  schema: z.array(z.union([z.string(), sourceSpecObjectSchema])),
};

const idsField: FieldDescriptor = {
  key: 'ids',
  schema: z.array(z.string()),
  default: [],
};

const forceField: FieldDescriptor = {
  key: 'force',
  schema: coercedBooleanSchema,
  default: false,
  flags: [
    {
      spec: '--force',
      description:
        'Rebuild a disk-backed glob index even when it is already fresh. Default: a fresh index is skipped.',
    },
  ],
};

// Glob index cache root, read from the top-level `index.dir` config block
// (ADR-0041, #345). No CLI flag — where disk-backed indexes live is a
// project-shaped deployment knob, so `sparqly index` writes to the same root
// the query/serve open path reads from.
const indexCacheDirField: FieldDescriptor = {
  key: 'indexCacheDir',
  schema: z.string().min(1),
};

/** Human-readable label for an index target: `@id`, or the bare glob. */
function targetLabel(target: IndexTarget): string {
  if (target.kind === 'file') return `@${target.id}`;
  return target.id !== undefined ? `@${target.id}` : target.glob;
}

/** One line summarizing what `ensureGlobIndex` did for a source. */
function renderOutcome(label: string, outcome: EnsureGlobIndexOutcome): string {
  if (outcome.status === 'skipped') {
    return `skipped\t${label}\n`;
  }
  return `built\t${label}\t${outcome.files.length} files\t${outcome.trigger}\n`;
}

export const indexSpec: CommandSpec<IndexConfig> = {
  name: 'index',
  description:
    'Build the Glob index for every `storage: disk` source in the config registry (ADR-0041). With no positional args, builds every disk-backed glob and split-glob file child; pass one or more `@id` refs to build only those. A non-disk-backed `@id` is rejected. An already-fresh index is skipped; a stale one is rebuilt. `--force` rebuilds even a fresh index. The build writes to a unique temp directory and atomic-renames into place once its manifest is written, so an interrupted build never leaves a half-index at the real path.',
  fields: [
    sourcesRegistryField,
    idsField,
    forceField,
    indexCacheDirField,
    ...verbosityFieldsFor('index'),
  ],
  positionals: [{ field: 'ids', name: 'id', variadic: true }],
  configScope: { sources: true },
  exitCode: () => 1,
  handler: async (config) => {
    const logger = configureLogger({
      verbose: config.verbose === true,
      quiet: config.quiet === true,
      logFormat: config.logFormat,
    });

    const configDir = process.cwd();
    const registry = await expandSplitGlobs(
      parseSourceSpecs(config.sources ?? []),
      {
        walkGlob: defaultGlobWalker,
        walkGitGlob: createGitTreeWalker({ configDir, logger }),
        logger,
      },
    );

    const targets = selectIndexTargets(registry, config.ids ?? []);
    if (targets.length === 0) {
      process.stdout.write('no disk-backed sources to index\n');
      return;
    }

    const sparqlyVersion = cliVersion();
    for (const target of targets) {
      const label = targetLabel(target);
      const { indexId, pattern } = diskBackedIndexIdentity(target);
      const indexDir = globIndexDir(configDir, indexId, config.indexCacheDir);
      const outcome = await ensureGlobIndex({
        glob: pattern,
        transforms: target.transforms ?? [],
        indexDir,
        sparqlyVersion,
        force: config.force === true,
      });
      if (outcome.isErr()) {
        throw new Error(`failed to index ${label}: ${outcome.error.message}`);
      }
      process.stdout.write(renderOutcome(label, outcome.value));
    }
  },
};
