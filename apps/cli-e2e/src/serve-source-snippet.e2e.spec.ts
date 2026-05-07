import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServe, type ServeHandle } from './helpers/serve';

const SAMPLE_TTL = [
  '@prefix ex: <http://example.org/> .',
  '',
  'ex:a ex:p ex:b .',
  'ex:a ex:q ex:c .',
  '',
].join('\n');

function snippetUrl(
  baseUrl: string,
  args: { file: string; line: number; context: number },
): string {
  const params = new URLSearchParams({
    file: args.file,
    line: String(args.line),
    context: String(args.context),
  });
  return `${baseUrl}/api/source-snippet?${params.toString()}`;
}

describe('sparqly serve — GET /api/source-snippet (issue #145)', () => {
  let scratch: string;
  let handle: ServeHandle | undefined;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-snippet-e2e-'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
    await rm(scratch, { recursive: true, force: true });
  });

  it('returns 200 + SnippetReadResult JSON for a loaded file', async () => {
    const dataPath = join(scratch, 'data.ttl');
    await writeFile(dataPath, SAMPLE_TTL);
    const configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: alpha
            glob: "${dataPath}"
      ` + '\n',
    );

    handle = await startServe(['--config', configPath]);

    const resp = await fetch(
      snippetUrl(handle.baseUrl, {
        file: pathToFileURL(dataPath).href,
        line: 3,
        context: 1,
      }),
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toMatch(/application\/json/);
    const json = (await resp.json()) as {
      kind: string;
      focalLine: number;
      startLine: number;
      lines: string[];
    };
    expect(json.kind).toBe('snippet');
    expect(json.focalLine).toBe(3);
    expect(json.startLine).toBe(2);
    expect(json.lines).toEqual(['', 'ex:a ex:p ex:b .', 'ex:a ex:q ex:c .']);
  });

  it('returns 403 for a path outside the loader allow-list', async () => {
    const dataPath = join(scratch, 'data.ttl');
    await writeFile(dataPath, SAMPLE_TTL);
    const sneakyPath = join(scratch, 'sneaky.txt');
    await writeFile(sneakyPath, 'do not read me\n');
    const configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: alpha
            glob: "${dataPath}"
      ` + '\n',
    );

    handle = await startServe(['--config', configPath]);

    const resp = await fetch(
      snippetUrl(handle.baseUrl, {
        file: pathToFileURL(sneakyPath).href,
        line: 1,
        context: 0,
      }),
    );
    expect(resp.status).toBe(403);
  });

  it('--watch rebuild updates the allow-list (newly-matched file becomes readable)', async () => {
    const initialPath = join(scratch, 'a.ttl');
    await writeFile(initialPath, SAMPLE_TTL);
    const configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: alpha
            glob: "${join(scratch, '*.ttl')}"
      ` + '\n',
    );

    handle = await startServe([
      '--config',
      configPath,
      '--watch',
      '--watch-debounce',
      '100',
    ]);

    const newPath = join(scratch, 'b.ttl');
    const beforeResp = await fetch(
      snippetUrl(handle.baseUrl, {
        file: pathToFileURL(newPath).href,
        line: 1,
        context: 0,
      }),
    );
    expect(beforeResp.status).toBe(403);

    await writeFile(newPath, SAMPLE_TTL);

    const deadline = Date.now() + 8000;
    let after: Response | undefined;
    do {
      await new Promise((r) => setTimeout(r, 200));
      after = await fetch(
        snippetUrl(handle.baseUrl, {
          file: pathToFileURL(newPath).href,
          line: 3,
          context: 0,
        }),
      );
    } while (after.status !== 200 && Date.now() < deadline);

    expect(after?.status).toBe(200);
    const json = (await after!.json()) as { kind: string; lines: string[] };
    expect(json.kind).toBe('snippet');
    expect(json.lines).toEqual(['ex:a ex:p ex:b .']);
  });
});
