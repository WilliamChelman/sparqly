import { Command } from 'commander';
import { COMMAND_REGISTRY } from './app/commands/registry';
import { discoverConfig } from './app/runner/discover-config';
import { makeFileLoader } from './app/runner/file-loader';
import { registerSpec } from './app/runner/runner';

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

bootstrap();
