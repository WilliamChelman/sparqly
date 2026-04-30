import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const CLI_BUNDLE_PATH = resolve(
  HERE,
  '../../../../dist/apps/cli/main.js',
);

export interface RunCliOptions {
  env?: Record<string, string | undefined>;
  cwd?: string;
  stdin?: string;
}

export interface RunCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runCli(
  args: string[],
  options: RunCliOptions = {},
): Promise<RunCliResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    };
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
    }

    const child = spawn(process.execPath, [CLI_BUNDLE_PATH, ...args], {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      resolvePromise({ stdout, stderr, exitCode: code ?? 0 });
    });

    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    child.stdin.end();
  });
}
