import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { CLI_BUNDLE_PATH } from './run-cli';

export interface ServeHandle {
  port: number;
  baseUrl: string;
  stderr(): string;
  close(): Promise<void>;
}

export interface ServeOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Wait timeout for the listening log line, in ms. Default 15000. */
  readyTimeoutMs?: number;
}

export async function startServe(
  args: string[],
  options: ServeOptions = {},
): Promise<ServeHandle> {
  const port = await getFreePort();
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

  const child = spawn(
    process.execPath,
    [CLI_BUNDLE_PATH, 'serve', '--port', String(port), ...args],
    { cwd: options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let stderrBuf = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf8');
  });
  child.stdout.on('data', () => {
    /* drain */
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForReady(
    child,
    baseUrl,
    () => stderrBuf,
    options.readyTimeoutMs ?? 15000,
  );

  return {
    port,
    baseUrl,
    stderr: () => stderrBuf,
    close: () => closeProcess(child),
  };
}

async function waitForReady(
  child: ChildProcess,
  baseUrl: string,
  getStderr: () => string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(
        `serve exited with code ${child.exitCode} before ready: ${getStderr()}`,
      );
    }
    try {
      const res = await fetch(
        `${baseUrl}/api/sparql?query=${encodeURIComponent('ASK { ?s ?p ?o }')}`,
      );
      await res.arrayBuffer();
      return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `serve did not become ready within ${timeoutMs}ms. stderr: ${getStderr()}`,
  );
}

function closeProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 2000);
  });
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const address = srv.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error('no port allocated'));
      }
    });
  });
}
