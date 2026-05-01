import { Logger } from '@nestjs/common';
import { Option, type Command } from 'commander';
import { configureLogger } from '../logging';
import type { FieldDescriptor } from './field';
import { blockSchemaFromFields } from './field';
import { mergeLayers, type ConfigSource } from './merge';
import type { CommandSpec } from './spec';

export interface FileLayers {
  readonly data: Record<string, unknown>;
  readonly filepath: string | null;
}

export interface WritableLike {
  write: (chunk: string) => unknown;
}

export interface RunnerContext {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly stdout?: WritableLike;
  readonly stderr?: WritableLike;
  readonly loadFile?: (configPath: string, cwd: string) => Promise<FileLayers>;
}

export function registerSpec<T extends Record<string, unknown>>(
  program: Command,
  spec: CommandSpec<T>,
  ctx: RunnerContext,
): Command {
  const positionalArgs = (spec.positionals ?? [])
    .map((p) => {
      const inner = p.variadic ? `${p.name}...` : p.name;
      return p.required ? `<${inner}>` : `[${inner}]`;
    })
    .join(' ');

  const sub = program
    .command(positionalArgs ? `${spec.name} ${positionalArgs}` : spec.name)
    .description(spec.description);

  const positionalsCount = (spec.positionals ?? []).length;
  const allowsVariadic = (spec.positionals ?? []).some((p) => p.variadic);

  applyFieldFlags(sub, spec.fields);
  sub.option('--config <path>', 'Path to a sparqly.config.{yaml,yml,json} file.');
  sub.option('--print-config', 'Print the fully-merged effective configuration and exit.');

  sub.action(async (...args: unknown[]) => {
    let rawConfig: Record<string, unknown> = {};
    try {
      const commanderInstance = args[args.length - 1] as Command;
      const optsBag = commanderInstance.opts() as Record<string, unknown>;
      const positionalValues = args.slice(0, -2) as unknown[];

      if (
        positionalsCount > 0 &&
        !allowsVariadic &&
        commanderInstance.args.length > positionalsCount
      ) {
        throw new Error(
          `${spec.name} takes at most ${numberWord(positionalsCount)} positional argument${
            positionalsCount === 1 ? '' : 's'
          } (got ${commanderInstance.args.length})`,
        );
      }

      const cli: Record<string, unknown> = {};
      for (const f of spec.fields) {
        const v = optsBag[f.key];
        if (v !== undefined) cli[f.key] = v;
      }
      spec.positionals?.forEach((p, i) => {
        const v = positionalValues[i];
        if (v === undefined || v === null) return;
        if (cli[p.field] !== undefined) return;
        cli[p.field] = v;
      });

      const explicitConfigPath =
        (optsBag.config as string | undefined) ?? ctx.env['SPARQLY_CONFIG'];
      const fileLayers: FileLayers =
        ctx.loadFile && explicitConfigPath !== undefined
          ? await ctx.loadFile(explicitConfigPath, ctx.cwd)
          : { data: {}, filepath: null };

      const env = readEnv(spec.fields, ctx.env);

      const merged = mergeLayers(spec.fields, {
        file: fileLayers.data,
        env,
        cli,
      });
      rawConfig = merged.config;

      const baseSchema = blockSchemaFromFields(spec.fields);
      const finalSchema = spec.refine ? spec.refine(baseSchema) : baseSchema;
      const validated = finalSchema.safeParse(merged.config);
      if (!validated.success) {
        throw new Error(formatIssues(validated.error.issues, spec.fields, merged.config));
      }

      const data = validated.data as Record<string, unknown>;
      configureLogger({
        verbose: data.verbose === true,
        quiet: data.quiet === true,
      });
      if (fileLayers.filepath && data.verbose === true) {
        new Logger('sparqly').log(`Loaded config from ${fileLayers.filepath}`);
      }

      if (optsBag.printConfig) {
        const out = ctx.stdout ?? process.stdout;
        out.write(
          formatPrintConfig({
            name: spec.name,
            fields: spec.fields,
            config: validated.data as Record<string, unknown>,
            sources: merged.sources,
            filepath: fileLayers.filepath,
          }),
        );
        return;
      }

      await spec.handler(validated.data as T);
    } catch (err) {
      const silent = (err as { silent?: boolean } | undefined)?.silent === true;
      if (!silent) {
        const msg = err instanceof Error ? err.message : String(err);
        (ctx.stderr ?? process.stderr).write(`error: ${msg}\n`);
      }
      process.exitCode = spec.exitCode(err, { rawConfig });
    }
  });

  return sub;
}

class AliasedOption extends Option {
  constructor(
    flags: string,
    description: string,
    private readonly attrName: string,
  ) {
    super(flags, description);
  }
  override attributeName(): string {
    return this.attrName;
  }
}

function applyFieldFlags(
  sub: Command,
  fields: ReadonlyArray<FieldDescriptor>,
): void {
  for (const f of fields) {
    for (const flag of f.flags ?? []) {
      const opt = flag.attributeName
        ? new AliasedOption(flag.spec, flag.description, flag.attributeName)
        : new Option(flag.spec, flag.description);
      if (flag.preset !== undefined) opt.preset(flag.preset);
      const parse = flag.parse;
      if (parse) opt.argParser((value, prev) => parse(value, prev));
      sub.addOption(opt);
    }
  }
}

function readEnv(
  fields: ReadonlyArray<FieldDescriptor>,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.env === undefined) continue;
    const names = typeof f.env === 'string' ? [f.env] : f.env;
    for (const name of names) {
      const v = env[name];
      if (v !== undefined) out[f.key] = v;
    }
  }
  return out;
}

interface PrintConfigInput {
  name: string;
  fields: ReadonlyArray<FieldDescriptor>;
  config: Record<string, unknown>;
  sources: Record<string, ConfigSource>;
  filepath: string | null;
}

function formatPrintConfig(input: PrintConfigInput): string {
  const orderedKeys = input.fields.map((f) => f.key);
  const entries: Array<{ key: string; valueStr: string; source: ConfigSource }> = [];
  for (const key of orderedKeys) {
    const source = input.sources[key];
    if (source === undefined) continue;
    entries.push({
      key,
      valueStr: formatValue(input.config[key]),
      source,
    });
  }
  const keyWidth = Math.max(0, ...entries.map((e) => e.key.length));
  const valueWidth = Math.max(0, ...entries.map((e) => e.valueStr.length));
  const lines: string[] = [];
  lines.push(`# sparqly ${input.name} --print-config`);
  lines.push(`# config file: ${input.filepath ?? '(none)'}`);
  for (const e of entries) {
    lines.push(
      `${e.key.padEnd(keyWidth)}: ${e.valueStr.padEnd(valueWidth)}  # ${e.source}`,
    );
  }
  return lines.join('\n') + '\n';
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

function numberWord(n: number): string {
  return n === 2 ? 'two' : String(n);
}

function flagFor(field: FieldDescriptor): string {
  for (const f of field.flags ?? []) {
    const match = f.spec.match(/--[a-zA-Z0-9-]+/);
    if (match) return match[0];
  }
  return `--${field.key}`;
}

function formatIssues(
  issues: ReadonlyArray<{ code?: string; path: ReadonlyArray<PropertyKey>; message: string; values?: ReadonlyArray<unknown> }>,
  fields: ReadonlyArray<FieldDescriptor>,
  rawValues: Record<string, unknown>,
): string {
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  return issues
    .map((issue) => {
      const key = String(issue.path[0] ?? '');
      const field = fieldByKey.get(key);
      const flag = field ? flagFor(field) : `--${key}`;
      if (issue.code === 'invalid_value' && Array.isArray(issue.values)) {
        const offered = rawValues[key];
        const expected = issue.values.join(', ');
        return `unknown ${flag} '${String(offered)}' (expected ${expected})`;
      }
      return `${flag}: ${issue.message}`;
    })
    .join('; ');
}
