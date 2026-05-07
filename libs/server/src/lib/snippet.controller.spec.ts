import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type CreatedServer } from './create-server';

const SAMPLE_TTL = [
  '@prefix ex: <http://example.org/> .',
  '',
  'ex:a ex:p ex:b .',
  'ex:a ex:q ex:c .',
  'ex:a ex:r ex:d .',
  'ex:a ex:s ex:e .',
  '',
].join('\n');

describe('GET /api/source-snippet', () => {
  let dir: string;
  let dataPath: string;
  let server: CreatedServer;
  let baseUrl: string;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    dir = await mkdtemp(join(tmpdir(), 'sparqly-snippet-'));
    dataPath = join(dir, 'data.ttl');
    await writeFile(dataPath, SAMPLE_TTL);
    server = await createServer({
      sources: join(dir, '*.ttl'),
      port: 0,
    });
    baseUrl = `http://localhost:${server.port}/api/source-snippet`;
  });

  afterAll(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  function snippetUrl(args: {
    file: string;
    line: number | string;
    context: number | string;
  }): string {
    const params = new URLSearchParams({
      file: args.file,
      line: String(args.line),
      context: String(args.context),
    });
    return `${baseUrl}?${params.toString()}`;
  }

  it('returns 200 + SnippetReadResult JSON for an allow-listed file', async () => {
    const fileUri = pathToFileURL(dataPath).href;
    const resp = await fetch(snippetUrl({ file: fileUri, line: 3, context: 1 }));

    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toMatch(/application\/json/);
    const json = (await resp.json()) as {
      kind: string;
      startLine: number;
      focalLine: number;
      lines: string[];
    };
    expect(json.kind).toBe('snippet');
    expect(json.focalLine).toBe(3);
    expect(json.startLine).toBe(2);
    expect(json.lines).toEqual(['', 'ex:a ex:p ex:b .', 'ex:a ex:q ex:c .']);
  });

  it('returns 403 for a file outside the allow-list', async () => {
    const otherPath = join(dir, 'not-loaded.ttl');
    const resp = await fetch(
      snippetUrl({
        file: pathToFileURL(otherPath).href,
        line: 1,
        context: 0,
      }),
    );
    expect(resp.status).toBe(403);
  });

  it('returns 403 even if the file exists on disk but is not allow-listed', async () => {
    const sneaky = join(dir, 'sneaky.txt');
    await writeFile(sneaky, 'secret\n');
    const resp = await fetch(
      snippetUrl({
        file: pathToFileURL(sneaky).href,
        line: 1,
        context: 0,
      }),
    );
    expect(resp.status).toBe(403);
  });

  it('returns 400 when `file` is missing', async () => {
    const resp = await fetch(`${baseUrl}?line=1&context=0`);
    expect(resp.status).toBe(400);
  });

  it('returns 400 when `file` is not a file:// URI', async () => {
    const resp = await fetch(
      snippetUrl({ file: 'http://example.com/x', line: 1, context: 0 }),
    );
    expect(resp.status).toBe(400);
  });

  it('returns 400 when `line` is not a positive integer', async () => {
    const fileUri = pathToFileURL(dataPath).href;
    const resp = await fetch(
      snippetUrl({ file: fileUri, line: 'banana', context: 0 }),
    );
    expect(resp.status).toBe(400);
  });

  it('returns 404 with `(source file unavailable)` payload when the allow-listed file disappears', async () => {
    // File was loaded once (so it is allow-listed) but is gone at request time.
    const goneDir = await mkdtemp(join(tmpdir(), 'sparqly-snippet-gone-'));
    const gonePath = join(goneDir, 'gone.ttl');
    await writeFile(gonePath, SAMPLE_TTL);
    const goneServer = await createServer({
      sources: join(goneDir, '*.ttl'),
      port: 0,
    });
    try {
      const fileUri = pathToFileURL(gonePath).href;
      await rm(gonePath);
      const resp = await fetch(
        `http://localhost:${goneServer.port}/api/source-snippet?` +
          new URLSearchParams({
            file: fileUri,
            line: '1',
            context: '0',
          }).toString(),
      );
      expect(resp.status).toBe(404);
      const json = (await resp.json()) as { kind: string; reason?: string };
      expect(json.kind).toBe('unavailable');
      expect(json.reason).toBe('missing');
    } finally {
      await goneServer.close();
      await rm(goneDir, { recursive: true, force: true });
    }
  });
});

describe('GET /api/source-snippet — --watch rebuild refreshes the allow-list', () => {
  let dir: string;
  let server: CreatedServer;
  let baseUrl: string;
  const debounceMs = 50;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    dir = await mkdtemp(join(tmpdir(), 'sparqly-snippet-watch-'));
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    server = await createServer({
      sources: join(dir, '*.ttl'),
      port: 0,
      watch: true,
      watchDebounceMs: debounceMs,
    });
    baseUrl = `http://localhost:${server.port}/api/source-snippet`;
  });

  afterAll(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  function snippetReq(absPath: string): Promise<Response> {
    const params = new URLSearchParams({
      file: pathToFileURL(absPath).href,
      line: '1',
      context: '0',
    });
    return fetch(`${baseUrl}?${params.toString()}`);
  }

  it('newly-matched files become readable after a watcher rebuild', async () => {
    const newPath = join(dir, 'b.ttl');
    const before = await snippetReq(newPath);
    expect(before.status).toBe(403);

    await writeFile(
      newPath,
      '@prefix ex: <http://example.org/> . ex:x ex:p ex:y .',
    );

    const deadline = Date.now() + 5000;
    let after: Response | undefined;
    do {
      await new Promise((r) => setTimeout(r, debounceMs * 2));
      after = await snippetReq(newPath);
    } while (after.status !== 200 && Date.now() < deadline);

    expect(after?.status).toBe(200);
  });

  it('removed files stop being readable after a watcher rebuild', async () => {
    const goingPath = join(dir, 'going.ttl');
    await writeFile(
      goingPath,
      '@prefix ex: <http://example.org/> . ex:m ex:p ex:n .',
    );

    const deadlineAdd = Date.now() + 5000;
    let added: Response | undefined;
    do {
      await new Promise((r) => setTimeout(r, debounceMs * 2));
      added = await snippetReq(goingPath);
    } while (added.status !== 200 && Date.now() < deadlineAdd);
    expect(added?.status).toBe(200);

    await rm(goingPath);

    const deadlineRm = Date.now() + 5000;
    let removed: Response | undefined;
    do {
      await new Promise((r) => setTimeout(r, debounceMs * 2));
      removed = await snippetReq(goingPath);
    } while (removed.status !== 403 && Date.now() < deadlineRm);
    expect(removed?.status).toBe(403);
  });
});
