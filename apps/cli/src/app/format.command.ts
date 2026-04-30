import { Logger } from '@nestjs/common';
import { Parser, type Quad } from 'n3';
import { Command, CommandRunner, Option } from 'nest-commander';
import { formatRdf, loadRdf, type FormatSerialization } from 'core';
import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { runWithConfig, type EffectiveOptions } from './config';
import { exitCodeFor, isAdapterFailure } from './cli-errors';
import { formatAdapter, type FormatRawOptions } from './format.adapter';

interface FormatOptions extends FormatRawOptions {
  config?: string;
  printConfig?: boolean;
}

@Command({
  name: 'format',
  description:
    'Pretty-print Turtle/TriG files. Reads a glob, or stdin when no glob is supplied, and writes the formatted result to stdout.',
  arguments: '[glob]',
})
export class FormatCommand extends CommandRunner {
  async run(passedParams: string[], options: FormatOptions = {}): Promise<void> {
    const adapted = formatAdapter(passedParams, options);
    if (isAdapterFailure(adapted)) {
      for (const err of adapted.errors) {
        process.stderr.write(`error: ${err.message}\n`);
      }
      process.exitCode = exitCodeFor('format');
      return;
    }

    await runWithConfig(
      {
        command: 'format',
        passedParams,
        options,
        cliOverrides: adapted.cliOverrides,
      },
      (effective) => this.execute(effective),
    );
  }

  private async execute(effective: EffectiveOptions): Promise<void> {
    const logger = new Logger('sparqly');
    const positional = effective.sources;
    const configPrefixes = effective.prefixes ?? {};
    const base = effective.base;
    const objectAnchoredPredicates = effective.objectAnchoredPredicates;
    const mode: 'stdout' | 'write' | 'check' = effective.write
      ? 'write'
      : effective.check
        ? 'check'
        : 'stdout';

    if (mode !== 'stdout') {
      if (typeof positional !== 'string' || positional.length === 0) {
        process.stderr.write(
          `error: --${mode} requires a glob (stdin is not supported in --${mode} mode)\n`,
        );
        process.exitCode = mode === 'check' ? 2 : 1;
        return;
      }
      await this.processPerFile({
        glob: positional,
        mode,
        configPrefixes,
        base,
        objectAnchoredPredicates,
        logger,
      });
      return;
    }

    if (typeof positional === 'string' && positional.length > 0) {
      try {
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
        process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: ${message}\n`);
        process.exitCode = 1;
      }
      return;
    }

    const stdinText = await readStdin();
    if (!stdinText) {
      process.stderr.write(
        'error: a glob is required, or pipe Turtle/TriG via stdin\n',
      );
      process.exitCode = 1;
      return;
    }

    try {
      const { quads, prefixes: stdinPrefixes } = parseStdin(stdinText);
      const serialization: FormatSerialization = quads.some(
        (q) => q.graph.termType === 'NamedNode',
      )
        ? 'trig'
        : 'turtle';
      const merged = mergePrefixes(
        { stdin: stdinPrefixes },
        configPrefixes,
      );
      const resolvedBase = base ?? extractBase(stdinText);
      const out = formatRdf(quads, serialization, {
        prefixes: merged,
        base: resolvedBase,
        objectAnchoredPredicates,
      });
      process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: failed to parse stdin: ${message}\n`);
      process.exitCode = 1;
    }
  }

  private async processPerFile(args: {
    glob: string;
    mode: 'write' | 'check';
    configPrefixes: Record<string, string>;
    base: string | undefined;
    objectAnchoredPredicates: string[] | undefined;
    logger: Logger;
  }): Promise<void> {
    const errorExit = args.mode === 'check' ? 2 : 1;
    let load;
    try {
      load = await loadRdf({ sources: args.glob });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: ${message}\n`);
      process.exitCode = errorExit;
      return;
    }
    const { files, prefixes: perFilePrefixes } = load;
    args.logger.log(`Loaded ${files.length} file(s) in --${args.mode} mode`);

    const unformatted: string[] = [];
    for (const file of files) {
      try {
        const { store: fileStore } = await loadRdf({ sources: file });
        const serialization = inferSerialization([file]);
        const fileMerged = mergePrefixes(
          { [file]: perFilePrefixes[file] ?? {} },
          args.configPrefixes,
        );
        const original = await readFile(file, 'utf8');
        const resolvedBase = args.base ?? extractBase(original);
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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: ${message}\n`);
        process.exitCode = errorExit;
        return;
      }
    }

    if (args.mode === 'check') {
      for (const path of unformatted) {
        process.stdout.write(`${path}\n`);
      }
      if (unformatted.length > 0) process.exitCode = 1;
    }
  }

  @Option({
    flags: '--prefix <name=iri>',
    description:
      'Add or override a prefix mapping (repeatable, highest precedence). Example: --prefix ex=http://example.org/',
  })
  parsePrefix(value: string, previous: string[] = []): string[] {
    return [...previous, value];
  }

  @Option({
    flags: '--write',
    description:
      'Rewrite each matched file in place with the formatted output. Mutually exclusive with --check.',
  })
  parseWrite(): boolean {
    return true;
  }

  @Option({
    flags: '--check',
    description:
      'Print the paths of unformatted files to stdout and exit non-zero (0 = all formatted, 1 = needs format, 2 = error). Does not mutate files. Mutually exclusive with --write.',
  })
  parseCheck(): boolean {
    return true;
  }

  @Option({ flags: '-v, --verbose', description: 'Verbose logging' })
  parseVerbose(): boolean {
    return true;
  }

  @Option({ flags: '--quiet', description: 'Suppress non-result output' })
  parseQuiet(): boolean {
    return true;
  }

  @Option({
    flags: '--config <path>',
    description:
      'Path to a sparqly.config.{yaml,yml,json} file. Disables auto-discovery; hard error if the path is missing or unparseable.',
  })
  parseConfig(value: string): string {
    return value;
  }

  @Option({
    flags: '--print-config',
    description:
      'Print the fully-merged effective configuration with the source of each value (default/file/env/flag) and exit 0.',
  })
  parsePrintConfig(): boolean {
    return true;
  }
}

const BASE_DIRECTIVE_RE = /^\s*@base\s+<([^>]+)>\s*\.\s*$/im;

function extractBase(text: string): string | undefined {
  const match = text.match(BASE_DIRECTIVE_RE);
  return match ? match[1] : undefined;
}

async function firstFileBase(files: string[]): Promise<string | undefined> {
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const base = extractBase(text);
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

interface ParsedStdin {
  quads: Quad[];
  prefixes: Record<string, string>;
}

function parseStdin(text: string): ParsedStdin {
  const prefixes: Record<string, string> = {};
  const quads = new Parser().parse(text, null, (prefix, iri) => {
    if (prefix && iri) {
      prefixes[prefix] = (iri as { value: string }).value;
    }
  });
  return { quads, prefixes };
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
