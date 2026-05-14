import type { IncomingMessage, ServerResponse } from 'node:http';

type Next = (err?: unknown) => void;

export function sparqlQueryBodyParser(
  req: IncomingMessage & { body?: unknown },
  _res: ServerResponse,
  next: Next,
): void {
  const ct = (req.headers['content-type'] ?? '').toLowerCase();
  if (!ct.includes('application/sparql-query')) {
    next();
    return;
  }
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  req.on('end', () => {
    req.body = Buffer.concat(chunks).toString('utf8');
    next();
  });
  req.on('error', next);
}
