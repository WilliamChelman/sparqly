import { readFile } from 'node:fs/promises';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  QueryEngine,
  SUPPORTED_FORMATS,
  formatRdf,
  loadSources,
  parseRdfString,
  parseSparqlPrefixes,
  type GraphMode,
  type SparqlFormat,
} from 'core';
import { configureLogger } from '../logging';
import { writeOutputToFile } from '../output';
import type { FieldDescriptor } from '../runner/field';
import {
  baseField,
  graphModeFieldFor,
  mutableFieldsFor,
  outFieldFor,
  prefixesField,
  sourcesField,
  verbosityFieldsFor,
} from '../runner/fields-shared';
import type { CommandSpec } from '../runner/spec';

interface QueryConfig {
  sources?: string | string[];
  query?: string;
  queryFile?: string;
  format?: SparqlFormat;
  graphMode?: GraphMode;
  mutable?: boolean;
  prefixes?: Record<string, string>;
  base?: string;
  out?: string;
  verbose?: boolean;
  quiet?: boolean;
}

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

export const querySpec: CommandSpec<QueryConfig> = {
  name: 'query',
  description: 'Run a SPARQL query against a glob of RDF files',
  fields: [
    sourcesField,
    queryField,
    queryFileField,
    formatField,
    graphModeFieldFor('query'),
    ...mutableFieldsFor('query'),
    prefixesField,
    baseField,
    outFieldFor('query'),
    ...verbosityFieldsFor('query'),
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
    const graphMode = config.graphMode;
    const format = config.format;
    const mutable = config.mutable === true;

    const loadStart = Date.now();
    const inputs = Array.isArray(config.sources)
      ? config.sources
      : [config.sources];
    const { store, files } = await loadSources(inputs, { graphMode });
    logger.log(
      `Loaded ${files.length} file(s) (${store.size} quads) in ${
        Date.now() - loadStart
      }ms`,
    );

    const queryStart = Date.now();
    const engine = new QueryEngine(store);
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
