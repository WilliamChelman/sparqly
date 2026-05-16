import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { SparqlyLogger } from 'common';
import { configureLogger } from '../../logging';
import { discoverConfig } from '../../runner/config/discover-config';
import type { FieldDescriptor } from '../../runner/fields/field';
import {
  coercedBooleanSchema,
  verbosityFieldsFor,
} from '../../runner/fields/fields-shared';
import type { CommandSpec } from '../../runner/fields/spec';
import { INIT_TEMPLATE_YAML } from './init-template';
import { planInit } from './plan-init';

interface InitConfig {
  force?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  logFormat?: 'text' | 'json';
}

const CWD_CONFIG_BASENAMES = [
  'sparqly.config.yaml',
  'sparqly.config.yml',
  'sparqly.config.json',
] as const;

const forceField: FieldDescriptor = {
  key: 'force',
  schema: coercedBooleanSchema,
  default: false,
  flags: [
    {
      spec: '--force',
      description:
        'Overwrite an existing sparqly.config.{yaml,yml,json} in the current directory. Default: refuse with exit code 1.',
    },
  ],
};

function findCwdConfig(cwd: string): string | null {
  for (const base of CWD_CONFIG_BASENAMES) {
    const candidate = join(cwd, base);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function findAncestorConfig(cwd: string): string | null {
  const parent = dirname(cwd);
  if (parent === cwd) return null;
  return discoverConfig({ cwd: parent });
}

export interface RunInitDeps {
  readonly cwd: string;
  readonly force: boolean;
  readonly stdout: { write(chunk: string): unknown };
  readonly logger: SparqlyLogger;
}

export async function runInit(deps: RunInitDeps): Promise<void> {
  const cwdConfigPath = findCwdConfig(deps.cwd);
  const ancestorConfigPath = findAncestorConfig(deps.cwd);
  const plan = planInit({
    cwd: deps.cwd,
    force: deps.force,
    cwdConfigPath,
    ancestorConfigPath,
  });

  if (plan.action === 'refuse') {
    throw new Error(
      `sparqly config already exists at ${plan.existingPath} — pass --force to overwrite`,
    );
  }

  await writeFile(plan.destination, INIT_TEMPLATE_YAML, 'utf8');
  if (plan.warnAncestor !== null) {
    deps.logger.warn(
      `wrote ${relative(deps.cwd, plan.destination) || 'sparqly.config.yaml'}; ancestor config at ${plan.warnAncestor} will be shadowed from this directory`,
    );
  }
  deps.stdout.write('wrote sparqly.config.yaml\n');
}

export const initSpec: CommandSpec<InitConfig> = {
  name: 'init',
  description:
    'Write a commented sparqly.config.yaml template to the current directory. Refuses to overwrite an existing config unless --force is passed; warns when an ancestor sparqly.config.* would otherwise govern the directory.',
  fields: [forceField, ...verbosityFieldsFor('init')],
  configScope: { sources: false },
  exitCode: () => 1,
  handler: async (config) => {
    const logger = configureLogger({
      verbose: config.verbose === true,
      quiet: config.quiet === true,
      logFormat: config.logFormat,
    });
    await runInit({
      cwd: process.cwd(),
      force: config.force === true,
      stdout: process.stdout,
      logger,
    });
  },
};
