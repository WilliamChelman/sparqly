import { Command, CommandRunner, Option } from 'nest-commander';
import { createServer } from 'server';

interface ServeOptions {
  sources?: string;
  port?: number;
  watch?: boolean;
  mutable?: boolean;
  immutable?: boolean;
  verbose?: boolean;
}

@Command({
  name: 'serve',
  description: 'Serve the SPARQL endpoint and YASGUI playground',
})
export class ServeCommand extends CommandRunner {
  async run(_passedParams: string[], options: ServeOptions): Promise<void> {
    const port = options.port ?? 3000;
    await createServer({ port });
  }

  @Option({
    flags: '-s, --sources <glob>',
    description: 'Glob of RDF files to load',
  })
  parseSources(value: string): string {
    return value;
  }

  @Option({
    flags: '-p, --port <port>',
    description: 'HTTP port (default: 3000)',
  })
  parsePort(value: string): number {
    return Number.parseInt(value, 10);
  }

  @Option({
    flags: '-w, --watch',
    description: 'Rebuild the store when source files change',
  })
  parseWatch(): boolean {
    return true;
  }

  @Option({
    flags: '--mutable',
    description: 'Allow mutating queries',
  })
  parseMutable(): boolean {
    return true;
  }

  @Option({
    flags: '--immutable [value]',
    description: 'Disallow mutating queries (default: true)',
  })
  parseImmutable(value: string): boolean {
    return value !== 'false';
  }

  @Option({ flags: '-v, --verbose', description: 'Verbose logging' })
  parseVerbose(): boolean {
    return true;
  }
}
