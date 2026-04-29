# cli-e2e

End-to-end tests for the `sparqly` CLI. Tests spawn the built bundle at
`dist/apps/cli/main.js` and assert against `stdout`, `stderr`, and exit code.

## Running

```bash
nx run cli-e2e:e2e
```

The target depends on `cli:build`, so the CLI bundle is rebuilt as needed.

## Helper

`src/helpers/run-cli.ts` exports `runCli(args, options?)` returning
`{ stdout, stderr, exitCode }`. Options accept `env`, `cwd`, and `stdin`.

## Fixtures

Small RDF inputs live in `fixtures/`. Reference them by absolute path resolved
from the spec file location, e.g.:

```ts
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(HERE, '../fixtures/minimal.ttl');
```

Keep fixtures small and readable. For test-specific scratch state, write to a
`mkdtemp` directory inside the spec — do not commit per-test files into
`fixtures/`.
