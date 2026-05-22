import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServe, type ServeHandle } from './helpers/serve';

const CLEARED_ENV = {
  SPARQLY_CONFIG: undefined,
  SPARQLY_VERBOSE: undefined,
  SPARQLY_QUIET: undefined,
} as const;

const ASK = 'ASK { ?s ?p ?o }';
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * End-to-end coverage for ADR-0042 / #350: on first touch of a not-yet-built
 * `storage: disk` glob, `serve` builds its Glob index in an isolated
 * `sparqly index` child process. `serve`'s HTTP loop stays responsive
 * throughout the build, and the child's inherited stderr surfaces the build's
 * progress logs in `serve`'s own output.
 */
describe('sparqly serve — child-process disk-backed index build (#350)', () => {
  let projectRoot: string;
  let handle: ServeHandle | undefined;

  beforeEach(async () => {
    projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-serve-index-')),
    );
    // A `.git` boundary stops config auto-discovery from walking onto the host.
    await mkdir(join(projectRoot, '.git'));
    await mkdir(join(projectRoot, 'data'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('builds the index in a child process while staying responsive', async () => {
    // Several files so the build spans a few HTTP polls — enough to observe
    // `serve` answering requests while the child build is still running.
    for (let i = 0; i < 24; i += 1) {
      await writeFile(
        join(projectRoot, 'data', `f${i}.ttl`),
        `@prefix ex: <http://example.org/> .\nex:s${i} ex:p ex:o${i} .\n`,
      );
    }
    await writeFile(
      join(projectRoot, 'sparqly.config.yaml'),
      dedent`
        sources:
          - id: data
            glob: data/*.ttl
            storage: disk
      ` + '\n',
    );

    handle = await startServe([], { cwd: projectRoot, env: CLEARED_ENV });

    const deadline = Date.now() + 20000;
    let dataStatus = 0;
    while (Date.now() < deadline) {
      const [dataRes, configRes] = await Promise.all([
        fetch(
          `${handle.baseUrl}/api/sparql/data?query=${encodeURIComponent(ASK)}`,
        ),
        fetch(`${handle.baseUrl}/api/config`),
      ]);
      await dataRes.arrayBuffer();
      await configRes.arrayBuffer();
      // `serve`'s HTTP loop never blocks on the build: `/api/config` — which
      // never touches the disk source — answers 200 whether or not the
      // child-process build is running.
      expect(configRes.status).toBe(200);
      dataStatus = dataRes.status;
      if (dataStatus === 200) break;
      await sleep(50);
    }

    // The child-process build finished and `serve` opened the index `ready`.
    expect(dataStatus).toBe(200);
    // The build ran in the spawned child: its progress logs reached `serve`'s
    // output through the child's inherited stderr (ADR-0042). `serve` itself
    // never emits `index-file-*` events — only the `index` build does.
    expect(handle.stderr()).toMatch(/index-file/);
    // The index materialized on disk under <configDir>/.sparqly/index/<id>/.
    const manifest = await stat(
      join(projectRoot, '.sparqly', 'index', 'data', 'manifest.json'),
    );
    expect(manifest.isFile()).toBe(true);
  });
});
