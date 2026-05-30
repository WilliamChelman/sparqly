import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { Command } from 'commander';
import { runQueryWorker, type WorkerPort } from 'server';
import { COMMAND_REGISTRY } from './app/commands/registry';
import { discoverConfig } from './app/runner/config/discover-config';
import { makeFileLoader } from './app/runner/config/file-loader';
import { registerSpec } from './app/runner/runner';

// ADR-0050: the query worker re-runs this same CLI bundle in a `worker_thread`
// (mirroring how the index build re-runs it as a child process). When that is
// the case, host the query worker loop instead of the commander program.
function maybeRunAsQueryWorker(): boolean {
  if (isMainThread) return false;
  const role = (workerData as { sparqlyRole?: string } | undefined)?.sparqlyRole;
  if (role !== 'query-worker' || parentPort === null) return false;
  runQueryWorker(parentPort as unknown as WorkerPort);
  return true;
}

async function bootstrap() {
  process.argv[1] = 'sparqly';

  const program = new Command('sparqly');
  for (const spec of COMMAND_REGISTRY.values()) {
    registerSpec(program, spec, {
      env: process.env,
      cwd: process.cwd(),
      loadFile: makeFileLoader(),
      discoverConfig: (cwd) => discoverConfig({ cwd }),
    });
  }
  await program.parseAsync(process.argv);
}

if (!maybeRunAsQueryWorker()) {
  bootstrap();
}
