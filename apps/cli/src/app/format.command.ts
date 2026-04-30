import { Logger } from '@nestjs/common';
import { Parser, type Quad } from 'n3';
import { Command, CommandRunner } from 'nest-commander';
import { formatRdf, loadRdf, type FormatSerialization } from 'core';
import { extname } from 'node:path';

@Command({
  name: 'format',
  description:
    'Pretty-print Turtle/TriG files. Reads a glob, or stdin when no glob is supplied, and writes the formatted result to stdout.',
  arguments: '[glob]',
})
export class FormatCommand extends CommandRunner {
  async run(passedParams: string[]): Promise<void> {
    const logger = new Logger('sparqly');
    const positional = passedParams[0];

    if (positional) {
      try {
        const start = Date.now();
        const { store, files, prefixes } = await loadRdf({ sources: positional });
        logger.log(
          `Loaded ${files.length} file(s) (${store.size} quads) in ${
            Date.now() - start
          }ms`,
        );
        const serialization = inferSerialization(files);
        const merged = mergeFilePrefixes(prefixes);
        const out = formatRdf(
          store.getQuads(null, null, null, null),
          serialization,
          { prefixes: merged },
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
      const { quads, prefixes } = parseStdin(stdinText);
      const serialization: FormatSerialization = quads.some(
        (q) => q.graph.termType === 'NamedNode',
      )
        ? 'trig'
        : 'turtle';
      const out = formatRdf(quads, serialization, { prefixes });
      process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: failed to parse stdin: ${message}\n`);
      process.exitCode = 1;
    }
  }
}

function inferSerialization(files: string[]): FormatSerialization {
  return files.some((f) => extname(f).toLowerCase() === '.trig')
    ? 'trig'
    : 'turtle';
}

function mergeFilePrefixes(
  perFile: Record<string, Record<string, string>>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const file of Object.keys(perFile)) {
    for (const [name, iri] of Object.entries(perFile[file])) {
      if (!(name in merged)) merged[name] = iri;
    }
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
