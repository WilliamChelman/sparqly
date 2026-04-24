import { Command, CommandRunner, Option } from 'nest-commander';

interface QueryOptions {
  sources?: string;
  query?: string;
  queryFile?: string;
  format?: string;
  mutable?: boolean;
  immutable?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

@Command({
  name: 'query',
  description: 'Run a SPARQL query against a glob of RDF files',
})
export class QueryCommand extends CommandRunner {
  async run(_passedParams: string[], _options: QueryOptions): Promise<void> {
    process.stderr.write('sparqly query: not yet implemented\n');
    process.exitCode = 1;
  }

  @Option({
    flags: '-s, --sources <glob>',
    description: 'Glob of RDF files to load',
  })
  parseSources(value: string): string {
    return value;
  }

  @Option({
    flags: '-q, --query <sparql>',
    description: 'Inline SPARQL query',
  })
  parseQuery(value: string): string {
    return value;
  }

  @Option({
    flags: '--query-file <path>',
    description: 'Path to a file containing the SPARQL query',
  })
  parseQueryFile(value: string): string {
    return value;
  }

  @Option({
    flags: '-f, --format <format>',
    description: 'Override the output format',
  })
  parseFormat(value: string): string {
    return value;
  }

  @Option({
    flags: '--mutable',
    description: 'Allow mutating queries (UPDATE/INSERT/DELETE/LOAD)',
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

  @Option({ flags: '--quiet', description: 'Suppress non-result output' })
  parseQuiet(): boolean {
    return true;
  }
}
