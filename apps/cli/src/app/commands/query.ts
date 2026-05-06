import { readFile } from 'node:fs/promises';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  formatRdf,
  parseRdfString,
  parseSourceSpecs,
  parseSparqlPrefixes,
  QueryEngine,
  resolveSource,
  selectTarget,
  SUPPORTED_FORMATS,
  type ParsedSource,
  type SourceSpecInput,
  type SparqlFormat,
} from 'core';
import { configureLogger } from '../logging';
import { writeOutputToFile } from '../output';
import type { FieldDescriptor } from '../runner/field';
import {
  baseField,
  mutableFieldsFor,
  outFieldFor,
  prefixesField,
  sourceField,
  verbosityFieldsFor,
} from '../runner/fields-shared';
import type { CommandSpec } from '../runner/spec';

interface QueryConfig {
  sources?: SourceSpecInput[];
  source?: SourceSpecInput;
  query?: string;
  queryFile?: string;
  format?: SparqlFormat;
  mutable?: boolean;
  prefixes?: Record<string, string>;
  base?: string;
  out?: string;
  verbose?: boolean;
  quiet?: boolean;
}

const sourceSpecObjectSchema = z.record(z.string(), z.unknown());

const sourcesRegistryField: FieldDescriptor = {
  key: 'sources',
  schema: z.array(z.union([z.string(), sourceSpecObjectSchema])),
};

const queryField: FieldDescriptor = {
  key: 'query',
  schema: z.string(),
  env: ['SPARQLY_QUERY_QUERY'],
  flags: [
    {
      spec: '-q, --query <sparql>',
      description: 'Inline SPARQL query',
    },
  ],
};

const queryFileField: FieldDescriptor = {
  key: 'queryFile',
  schema: z.string(),
  env: ['SPARQLY_QUERY_QUERY_FILE'],
  flags: [
    {
      spec: '--query-file <path>',
      description: 'Path to a file containing the SPARQL query',
    },
  ],
};

const formatField: FieldDescriptor = {
  key: 'format',
  schema: z.enum(SUPPORTED_FORMATS),
  env: ['SPARQLY_QUERY_FORMAT'],
  flags: [
    {
      spec: '-f, --format <format>',
      description: 'Override the output format',
    },
  ],
};

export function resolveQueryTarget(config: QueryConfig): ParsedSource {
  const registry = parseSourceSpecs(config.sources ?? []);
  const targetArg =
    typeof config.source === 'string' ? config.source : undefined;
  if (config.source !== undefined && targetArg === undefined) {
    return parseSourceSpecs([config.source])[0];
  }
  return selectTarget(registry, targetArg);
}

export const querySpec: CommandSpec<QueryConfig> = {
  name: 'query',
  description: 'Run a SPARQL query against a target source (an `@id` ref into the config registry, or an inline glob/URL)',
  fields: [
    sourceField,
    sourcesRegistryField,
    queryField,
    queryFileField,
    formatField,
    ...mutableFieldsFor('query'),
    prefixesField,
    baseField,
    outFieldFor('query'),
    ...verbosityFieldsFor('query'),
  ],
  positionals: [{ field: 'source', name: 'glob' }],
  configScope: { sources: true },
  exitCode: () => 1,
  handler: async (config) => {
    configureLogger({
      verbose: config.verbose === true,
      quiet: config.quiet === true,
    });

    const stdinQuery = await readStdin();
    const querySources: string[] = [];
    if (config.query) querySources.push('-q/--query');
    if (config.queryFile) querySources.push('--query-file');
    if (stdinQuery) querySources.push('stdin');

    if (querySources.length > 1) {
      throw new Error(
        `only one query source allowed (got ${querySources.join(', ')})`,
      );
    }
    if (querySources.length === 0) {
      throw new Error('a query is required (-q, --query-file, or stdin)');
    }

    let query: string;
    if (config.query) {
      query = config.query;
    } else if (config.queryFile) {
      try {
        query = await readFile(config.queryFile, 'utf8');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`failed to read --query-file: ${message}`);
      }
    } else {
      query = stdinQuery as string;
    }

    const logger = new Logger('sparqly');
    const format = config.format;
    const mutable = config.mutable === true;

    const target = resolveQueryTarget(config);
    const registry = parseSourceSpecs(config.sources ?? []);

    const loadStart = Date.now();
    const sources = await resolveSource(target, { registry });
    let engine: QueryEngine;
    if (sources.mode === 'pass-through') {
      logger.log(
        `Federating to endpoint ${sources.endpoint.endpoint} in ${
          Date.now() - loadStart
        }ms`,
      );
      engine = new QueryEngine(sources.endpoint);
    } else {
      logger.log(
        `Loaded ${sources.files.length} file(s) (${sources.store.size} quads) in ${
          Date.now() - loadStart
        }ms`,
      );
      engine = new QueryEngine(sources.store);
    }

    const queryStart = Date.now();
    const result = await engine.execute(query, { format, mutable });
    logger.log(`Query executed in ${Date.now() - queryStart}ms`);

    const rendered =
      result.format === 'turtle'
        ? formatTurtleResult(result.body, query, config)
        : result.body;
    const body = rendered.endsWith('\n') ? rendered : `${rendered}\n`;
    if (config.out !== undefined) {
      await writeOutputToFile({
        out: config.out,
        cwd: process.cwd(),
        body,
      });
    } else {
      process.stdout.write(body);
    }
  },
};

function formatTurtleResult(
  body: string,
  query: string,
  config: QueryConfig,
): string {
  const { quads } = parseRdfString(body, { format: 'turtle' });
  const prefixes: Record<string, string> = {
    ...(config.prefixes ?? {}),
    ...parseSparqlPrefixes(query),
  };
  return formatRdf(quads, 'turtle', { prefixes, base: config.base });
}

async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text.length > 0 ? text : null;
}
