import { Logger, type LogLevel } from '@nestjs/common';

export interface LoggerOptions {
  verbose?: boolean;
  quiet?: boolean;
}

export function configureLogger(options: LoggerOptions): void {
  if (options.quiet) {
    Logger.overrideLogger(false);
    return;
  }
  const levels: LogLevel[] = options.verbose
    ? ['error', 'warn', 'log', 'debug', 'verbose']
    : ['error', 'warn', 'log'];
  Logger.overrideLogger(new StderrLogger(levels));
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
