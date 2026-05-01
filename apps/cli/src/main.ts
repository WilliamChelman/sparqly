import { Command } from 'commander';
import { CommandFactory } from 'nest-commander';
import { AppModule } from './app/app.module';
import { COMMAND_REGISTRY } from './app/commands/registry';
import { makeFileLoader } from './app/runner/file-loader';
import { registerSpec } from './app/runner/runner';

async function bootstrap() {
  process.argv[1] = 'sparqly';

  const requested = process.argv[2];
  const spec = requested ? COMMAND_REGISTRY.get(requested) : undefined;
  if (spec) {
    const program = new Command('sparqly');
    registerSpec(program, spec, {
      env: process.env,
      cwd: process.cwd(),
      loadFile: makeFileLoader(spec.name as 'hash'),
    });
    await program.parseAsync(process.argv);
    return;
  }

  await CommandFactory.run(AppModule, {
    cliName: 'sparqly',
    logger: ['error', 'warn'],
  });
}

bootstrap();
