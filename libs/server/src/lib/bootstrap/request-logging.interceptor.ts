import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Observable, tap } from 'rxjs';
import type { SparqlyLogFields, SparqlyLogger } from 'common';

/**
 * Emits one `request` line per HTTP request into `serve` (ADR-0020): method,
 * route path (never the query string), status, duration and response size, at
 * the default-on `info` level. On a 4xx/5xx the handler error message is
 * appended. Registered globally by {@link createServer}.
 */
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: SparqlyLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<IncomingMessage & { path?: string }>();
    const res = http.getResponse<ServerResponse>();
    const method = req.method ?? 'GET';
    const path = req.path ?? requestPath(req.url);
    const start = Date.now();
    let handlerError: unknown;

    res.on('finish', () => {
      const status = res.statusCode;
      const fields: SparqlyLogFields = {
        method,
        path,
        status,
        ms: Date.now() - start,
        bytes: responseBytes(res),
      };
      if (handlerError !== undefined) {
        fields['error'] =
          handlerError instanceof Error
            ? handlerError.message
            : String(handlerError);
      }
      this.logger.info('request', fields);
    });

    return next.handle().pipe(
      tap({
        error: (err: unknown) => {
          handlerError = err;
        },
      }),
    );
  }
}

function requestPath(url: string | undefined): string {
  if (!url) return '/';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function responseBytes(res: ServerResponse): number {
  const header = res.getHeader('content-length');
  if (typeof header === 'number') return header;
  if (typeof header === 'string') {
    const n = Number.parseInt(header, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
