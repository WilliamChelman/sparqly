import { Logger, type LogLevel } from '@nestjs/common';
import {
  formatLogLine,
  noopLogger,
  type LogFormat,
  type SparqlyLogFields,
  type SparqlyLogLevel,
  type SparqlyLogger,
} from 'common';

export interface LoggerOptions {
  verbose?: boolean;
  quiet?: boolean;
  logFormat?: LogFormat;
  /** Context tag attached to lines emitted via the returned `SparqlyLogger`. */
  context?: string;
}

const LOG_CONTEXT = 'sparqly';

/**
 * Configures NestJS's `Logger` (verbose/quiet gating, stderr destination) and
 * returns a {@link SparqlyLogger} that emits timestamped, level-tagged lines in
 * the chosen format (see ADR-0020). With `--quiet` the returned logger is the
 * no-op logger.
 */
export function configureLogger(options: LoggerOptions): SparqlyLogger {
  if (options.quiet) {
    Logger.overrideLogger(false);
    return noopLogger;
  }
  const verbose = options.verbose === true;
  const levels: LogLevel[] = verbose
    ? ['error', 'warn', 'log', 'debug', 'verbose']
    : ['error', 'warn', 'log'];
  Logger.overrideLogger(new StderrLogger(levels));
  return new StderrSparqlyLogger(
    options.logFormat ?? 'text',
    verbose,
    options.context ?? LOG_CONTEXT,
  );
}

class StderrSparqlyLogger implements SparqlyLogger {
  constructor(
    private readonly format: LogFormat,
    private readonly verbose: boolean,
    private readonly context: string,
  ) {}

  private emit(
    level: SparqlyLogLevel,
    msg: string,
    fields?: SparqlyLogFields,
  ): void {
    if (level === 'debug' && !this.verbose) return;
    const line = formatLogLine(this.format, {
      ts: new Date(),
      level,
      ctx: this.context,
      msg,
      fields,
    });
    process.stderr.write(`${line}\n`);
  }

  debug(msg: string, fields?: SparqlyLogFields): void {
    this.emit('debug', msg, fields);
  }
  info(msg: string, fields?: SparqlyLogFields): void {
    this.emit('info', msg, fields);
  }
  warn(msg: string, fields?: SparqlyLogFields): void {
    this.emit('warn', msg, fields);
  }
  error(msg: string, fields?: SparqlyLogFields): void {
    this.emit('error', msg, fields);
  }
}

class StderrLogger {
  constructor(private readonly levels: ReadonlyArray<LogLevel>) {}

  private write(level: LogLevel, message: unknown, context?: string): void {
    if (!this.levels.includes(level)) return;
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    const prefix = context ? `[${context}] ` : '';
    process.stderr.write(`${prefix}${text}\n`);
  }

  log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }
  error(message: unknown, _trace?: string, context?: string): void {
    this.write('error', message, context);
  }
  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }
  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }
}
