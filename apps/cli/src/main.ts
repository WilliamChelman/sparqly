import { CommandFactory } from 'nest-commander';
import { AppModule } from './app/app.module';

async function bootstrap() {
  process.argv[1] = 'sparqly';
  await CommandFactory.run(AppModule, {
    cliName: 'sparqly',
    logger: ['error', 'warn'],
  });
}

bootstrap();
