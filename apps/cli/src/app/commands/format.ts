import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  formatRdf,
  parseRdfString,
  type FormatSerialization,
} from 'common';
import { loadRdf, parseSourceSpec, type SourceSpecInput } from 'core';
import { configureLogger } from '../logging';
import { writeOutputToFile } from '../output';
import type { FieldDescriptor } from '../runner/field';
import {
  coercedBooleanSchema,
  contextBaseField,
  contextPrefixesField,
  sourcesField,
  verbosityFieldsFor,
} from '../runner/fields-shared';
import type { CommandSpec } from '../runner/spec';

interface FormatConfig {
  sources?: string | string[];
  prefixes?: Record<string, string>;
  base?: string;
  objectAnchoredPredicates?: string[];
  write?: boolean;
  check?: boolean;
  out?: string;
  verbose?: boolean;
  quiet?: boolean;
}

class FormatCheckMismatchSignal extends Error {
  readonly silent = true;
  constructor() {
    super('unformatted files');
    this.name = 'FormatCheckMismatchSignal';
  }
}

const writeField: FieldDescriptor = {
  key: 'write',
  schema: coercedBooleanSchema,
  flags: [
    {
      spec: '--write',
      description:
        'Rewrite each matched file in place with the formatted output. Mutually exclusive with --check.',
    },
  ],
};

const checkField: FieldDescriptor = {
  key: 'check',
  schema: coercedBooleanSchema,
  flags: [
    {
      spec: '--check',
      description:
        'Print the paths of unformatted files to stdout and exit non-zero (0 = all formatted, 1 = needs format, 2 = error). Does not mutate files. Mutually exclusive with --write.',
    },
  ],
};

const objectAnchoredPredicatesField: FieldDescriptor = {
  key: 'objectAnchoredPredicates',
  schema: z.array(z.string()),
};

const formatOutField: FieldDescriptor = {
  key: 'out',
  schema: z.string(),
  flags: [
    {
      spec: '-o, --out <path>',
      description:
        'Write the formatted body to <path> (CWD-relative) instead of stdout. Only applies in stdout mode (no --write/--check). Creates parent directories, silently overwrites, and replaces symlinks at the target.',
    },
  ],
};

export const formatSpec: CommandSpec<FormatConfig> = {
  name: 'format',
  description:
    'Pretty-print Turtle/TriG files. Reads a glob, or stdin when no glob is supplied, and writes the formatted result to stdout.',
  fields: [
    sourcesField,
    contextPrefixesField,
    contextBaseField,
    objectAnchoredPredicatesField,
    writeField,
    checkField,
    formatOutField,
    ...verbosityFieldsFor('format'),
  ],
  positionals: [{ field: 'sources', name: 'glob' }],
  configScope: { sources: true, block: 'format' },
  refine: (schema) =>
    (schema as z.ZodObject).superRefine(
      (val: Record<string, unknown>, ctx) => {
        if (val.write === true && val.check === true) {
          ctx.addIssue({
            code: 'custom',
            message: '--write and --check are mutually exclusive',
            path: ['write'],
          });
        }
        if (
          val.out !== undefined &&
          (val.write === true || val.check === true)
        ) {
          ctx.addIssue({
            code: 'custom',
            message: '--out cannot be combined with --write or --check',
            path: ['out'],
          });
        }
        const sources = val.sources;
        if (sources !== undefined) {
          const list: SourceSpecInput[] = Array.isArray(sources)
            ? (sources as SourceSpecInput[])
            : [sources as SourceSpecInput];
          list.forEach((entry, i) => {
            const issue = sourceIssue(entry);
            if (!issue) return;
            ctx.addIssue({
              code: 'custom',
              message: issue,
              path: Array.isArray(sources) ? ['sources', i] : ['sources'],
            });
          });
        }
      },
    ),
  exitCode: (err, ctx) => {
    if (err instanceof FormatCheckMismatchSignal) return 1;
    return ctx?.rawConfig?.check === true ? 2 : 1;
  },
  handler: async (config) => {
    configureLogger({
      verbose: config.verbose === true,
      quiet: config.quiet === true,
    });

    const logger = new Logger('sparqly');
    const positional = typeof config.sources === 'string' ? config.sources : '';
    const configPrefixes = config.prefixes ?? {};
    const base = config.base;
    const objectAnchoredPredicates = config.objectAnchoredPredicates;
    const mode: 'stdout' | 'write' | 'check' = config.write
      ? 'write'
      : config.check
        ? 'check'
        : 'stdout';

    if (mode !== 'stdout') {
      if (positional.length === 0) {
        throw new Error(
          `--${mode} requires a glob (stdin is not supported in --${mode} mode)`,
        );
      }
      await processPerFile({
        glob: positional,
        mode,
        configPrefixes,
        base,
        objectAnchoredPredicates,
        logger,
      });
      return;
    }

    if (positional.length > 0) {
      const start = Date.now();
      const { store, files, prefixes } = await loadRdf({ sources: positional });
      logger.log(
        `Loaded ${files.length} file(s) (${store.size} quads) in ${
          Date.now() - start
        }ms`,
      );
      const serialization = inferSerialization(files);
      const merged = mergePrefixes(prefixes, configPrefixes);
      const resolvedBase = base ?? (await firstFileBase(files));
      const out = formatRdf(
        store.getQuads(null, null, null, null),
        serialization,
        {
          prefixes: merged,
          base: resolvedBase,
          objectAnchoredPredicates,
        },
      );
      const body = out.endsWith('\n') ? out : `${out}\n`;
      await emit(body, config.out);
      return;
    }

    const stdinText = await readStdin();
    if (!stdinText) {
      throw new Error('a glob is required, or pipe Turtle/TriG via stdin');
    }

    let parsed: ReturnType<typeof parseRdfString>;
    try {
      parsed = parseRdfString(stdinText);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`failed to parse stdin: ${message}`);
    }

    const { quads, prefixes: stdinPrefixes, base: stdinBase } = parsed;
    const serialization: FormatSerialization = quads.some(
      (q) => q.graph.termType === 'NamedNode',
    )
      ? 'trig'
      : 'turtle';
    const merged = mergePrefixes(
      { stdin: stdinPrefixes },
      configPrefixes,
    );
    const resolvedBase = base ?? stdinBase;
    const out = formatRdf(quads, serialization, {
      prefixes: merged,
      base: resolvedBase,
      objectAnchoredPredicates,
    });
    const body = out.endsWith('\n') ? out : `${out}\n`;
    await emit(body, config.out);
  },
};

function sourceIssue(entry: SourceSpecInput): string | null {
  let parsed;
  try {
    parsed = parseSourceSpec(entry);
  } catch {
    return null;
  }
  if (parsed.kind === 'endpoint') {
    return `SPARQL endpoint ${parsed.endpoint} cannot be used as a format source (format is a round-trip-a-file contract; pipe \`sparqly query --format=turtle\` into \`sparqly format\` for a filtered round-trip)`;
  }
  return null;
}

async function emit(body: string, out: string | undefined): Promise<void> {
  if (out !== undefined) {
    await writeOutputToFile({ out, cwd: process.cwd(), body });
  } else {
    process.stdout.write(body);
  }
}

async function processPerFile(args: {
  glob: string;
  mode: 'write' | 'check';
  configPrefixes: Record<string, string>;
  base: string | undefined;
  objectAnchoredPredicates: string[] | undefined;
  logger: Logger;
}): Promise<void> {
  const { files, prefixes: perFilePrefixes } = await loadRdf({
    sources: args.glob,
  });
  args.logger.log(`Loaded ${files.length} file(s) in --${args.mode} mode`);

  const unformatted: string[] = [];
  for (const file of files) {
    const { store: fileStore } = await loadRdf({ sources: file });
    const serialization = inferSerialization([file]);
    const fileMerged = mergePrefixes(
      { [file]: perFilePrefixes[file] ?? {} },
      args.configPrefixes,
    );
    const original = await readFile(file, 'utf8');
    const resolvedBase = args.base ?? parseRdfString(original).base;
    const formattedRaw = formatRdf(
      fileStore.getQuads(null, null, null, null),
      serialization,
      {
        prefixes: fileMerged,
        base: resolvedBase,
        objectAnchoredPredicates: args.objectAnchoredPredicates,
      },
    );
    const formatted = formattedRaw.endsWith('\n')
      ? formattedRaw
      : `${formattedRaw}\n`;

    if (args.mode === 'write') {
      if (formatted !== original) {
        await writeFile(file, formatted);
      }
    } else if (formatted !== original) {
      unformatted.push(file);
    }
  }

  if (args.mode === 'check') {
    for (const path of unformatted) {
      process.stdout.write(`${path}\n`);
    }
    if (unformatted.length > 0) throw new FormatCheckMismatchSignal();
  }
}

async function firstFileBase(files: string[]): Promise<string | undefined> {
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const { base } = parseRdfString(text);
    if (base) return base;
  }
  return undefined;
}

function inferSerialization(files: string[]): FormatSerialization {
  return files.some((f) => extname(f).toLowerCase() === '.trig')
    ? 'trig'
    : 'turtle';
}

function mergePrefixes(
  perFile: Record<string, Record<string, string>>,
  configPrefixes: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const file of Object.keys(perFile)) {
    for (const [name, iri] of Object.entries(perFile[file])) {
      if (!(name in merged)) merged[name] = iri;
    }
  }
  for (const [name, iri] of Object.entries(configPrefixes)) {
    merged[name] = iri;
  }
  return merged;
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

export { FormatCheckMismatchSignal };
