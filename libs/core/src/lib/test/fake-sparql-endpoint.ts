import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

export interface FakeSparqlResponse {
  status?: number;
  contentType?: string;
  body: string;
}

export type FakeSparqlHandler = (req: {
  query: string;
  method: 'GET' | 'POST';
  headers: Record<string, string | string[] | undefined>;
}) => FakeSparqlResponse | Promise<FakeSparqlResponse>;

export interface FakeSparqlEndpoint {
  url: string;
  /** Number of inbound requests received. */
  requestCount(): number;
  close(): Promise<void>;
}

/**
 * Stand up a minimal SPARQL HTTP endpoint backed by `handler`. The endpoint
 * accepts both GET (?query=) and POST (form / sparql-query) at the root path.
 */
export async function startFakeSparqlEndpoint(
  handler: FakeSparqlHandler,
): Promise<FakeSparqlEndpoint> {
  let count = 0;
  const server: Server = createServer((req, res) => {
    count += 1;
    const method = req.method === 'POST' ? 'POST' : 'GET';
    const collect = async (): Promise<string> => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString('utf8');
    };

    void (async (): Promise<void> => {
      try {
        let query = '';
        if (method === 'GET') {
          const url = new URL(req.url ?? '/', 'http://localhost');
          query = url.searchParams.get('query') ?? '';
        } else {
          const body = await collect();
          const ct = String(req.headers['content-type'] ?? '');
          if (ct.includes('application/sparql-query')) {
            query = body;
          } else {
            const params = new URLSearchParams(body);
            query = params.get('query') ?? '';
          }
        }

        const r = await handler({ query, method, headers: req.headers });
        res.statusCode = r.status ?? 200;
        res.setHeader(
          'content-type',
          r.contentType ?? 'application/sparql-results+json',
        );
        res.end(r.body);
      } catch (err) {
        res.statusCode = 500;
        res.end(err instanceof Error ? err.message : String(err));
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}/sparql`;

  return {
    url,
    requestCount: () => count,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
