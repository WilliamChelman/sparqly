import type { z } from 'zod';
import {
  createGitTreeWalker,
  defaultGlobWalker,
  expandSplitGlobs,
  parseSourceSpecs,
  type SourceSpecInput,
} from 'core';
import { configureLogger } from '../../logging';
import {
  DiffErrorSignal,
  decorateDiffError,
  diffErrorExitCode,
} from '../diff-error';
import type { CommandSpec } from '../../runner/fields/spec';
import {
  contextBaseField,
  contextPrefixesField,
  outFieldFor,
  verbosityFieldsFor,
} from '../../runner/fields/fields-shared';
import {
  formatField,
  inferDiffFormatFromOut,
  leftField,
  leftQueryField,
  leftQueryFileField,
  leftRefField,
  queryField,
  queryFileField,
  rightField,
  rightQueryField,
  rightQueryFileField,
  rightRefField,
  snippetContextField,
  sourcesRegistryField,
  type DiffFormat,
} from './fields';
import { applyAtOverride } from '../at-override';
import { runGraphDiff } from './graph-runner';
import {
  loadSideInlineScopeQuery,
  loadSymmetricInlineScopeQuery,
  resolveDiffSide,
} from './side';
import { detectTabularDispatch, runTabularDiff } from './tabular-runner';
import { refineDiffConfig } from './validation';

export interface DiffConfig {
  sources?: SourceSpecInput[];
  left?: SourceSpecInput;
  right?: SourceSpecInput;
  format?: DiffFormat;
  prefixes?: Record<string, string>;
  base?: string;
  out?: string;
  snippetContext?: number;
  query?: string;
  queryFile?: string;
  leftQuery?: string;
  leftQueryFile?: string;
  rightQuery?: string;
  rightQueryFile?: string;
  leftRef?: string;
  rightRef?: string;
  verbose?: boolean;
  quiet?: boolean;
  logFormat?: 'text' | 'json';
}

export class DiffPresentSignal extends Error {
  readonly silent = true;
  constructor() {
    super('diff present');
    this.name = 'DiffPresentSignal';
  }
}

export const diffSpec: CommandSpec<DiffConfig> = {
  name: 'diff',
  description:
    'Compute a semantic diff between two target sources via RDFC-1.0 canonicalization. Each side accepts an `@id` ref into the config registry or an inline glob/URL. Materializes the *result* on both sides; for endpoint-backed views the query passes through to the endpoint. Glob/file targets carry per-quad source records (file + line) attached by the loader, so HTML and other formats surface line numbers without ceremony. A SPARQL endpoint target is rejected as a raw input on either side (wrap it in a `view` source kind to scope it, or pass `--query`/`--query-file`/`--left-query`/`--right-query`). Determinism caveat: a remote endpoint can return different data between runs, so a SPARQL diff is only as deterministic as the endpoint. Note: RDFC-1.0 does not normalize literal lexical forms.',
  fields: [
    leftField,
    rightField,
    sourcesRegistryField,
    queryField,
    queryFileField,
    leftQueryField,
    leftQueryFileField,
    rightQueryField,
    rightQueryFileField,
    leftRefField,
    rightRefField,
    formatField,
    snippetContextField,
    contextPrefixesField,
    contextBaseField,
    outFieldFor('diff'),
    ...verbosityFieldsFor('diff'),
  ],
  positionals: [
    { field: 'left', name: 'left' },
    { field: 'right', name: 'right' },
  ],
  configScope: { sources: true },
  refine: (schema) => refineDiffConfig(schema as z.ZodObject),
  exitCode: (err) => {
    if (err instanceof DiffPresentSignal) return 1;
    if (err instanceof DiffErrorSignal) return diffErrorExitCode(err.diffError);
    return 2;
  },
  handler: async (config) => {
    try {
      await runDiff(config);
    } catch (e) {
      if (e instanceof DiffErrorSignal) {
        const color = process.stderr.isTTY === true;
        process.stderr.write(`${decorateDiffError(e.diffError, { color })}\n`);
      }
      throw e;
    }
  },
};

async function runDiff(config: DiffConfig): Promise<void> {
  const logger = configureLogger({
    verbose: config.verbose === true,
    quiet: config.quiet === true,
    logFormat: config.logFormat,
  });

  const format = (config.format ??
    inferDiffFormatFromOut(config.out) ??
    'human') as DiffFormat;
  const quiet = config.quiet === true;

  const symmetricInlineQuery = await loadSymmetricInlineScopeQuery(config);
  const [leftInlineQuery, rightInlineQuery] = await Promise.all([
    loadSideInlineScopeQuery(
      symmetricInlineQuery,
      config.leftQuery,
      config.leftQueryFile,
    ),
    loadSideInlineScopeQuery(
      symmetricInlineQuery,
      config.rightQuery,
      config.rightQueryFile,
    ),
  ]);

  const registry = await expandSplitGlobs(
    parseSourceSpecs(config.sources ?? []),
    {
      walkGlob: defaultGlobWalker,
      walkGitGlob: createGitTreeWalker({
        configDir: process.cwd(),
        logger,
      }),
      logger,
    },
  );

  const leftTarget = applyAtOverride(
    resolveDiffSide(config, 'left', registry),
    config.leftRef,
  );
  const rightTarget = applyAtOverride(
    resolveDiffSide(config, 'right', registry),
    config.rightRef,
  );

  const tabularDispatch = detectTabularDispatch(
    leftInlineQuery,
    rightInlineQuery,
  );
  if (tabularDispatch) {
    await runTabularDiff({
      config,
      format,
      quiet,
      logger,
      leftTarget,
      rightTarget,
      leftInlineQuery: leftInlineQuery as string,
      rightInlineQuery: rightInlineQuery as string,
      leftShape: tabularDispatch.left,
      rightShape: tabularDispatch.right,
    });
    return;
  }

  await runGraphDiff({
    config,
    format,
    quiet,
    logger,
    leftTarget,
    rightTarget,
    leftInlineQuery,
    rightInlineQuery,
    registry,
  });
}
