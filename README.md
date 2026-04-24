# sparqly

RDF CLI with SPARQL query and an embedded YASGUI playground.

> v1 scaffold — commands are stubs; the query engine, loader, and HTTP endpoint
> are not yet implemented. See [PRD #1](https://github.com/WilliamChelman/sparqly/issues/1).

## Workspace layout

This is an Nx monorepo managed with pnpm.

| Path            | Kind          | Purpose                                                                          |
| --------------- | ------------- | -------------------------------------------------------------------------------- |
| `apps/cli`      | NestJS app    | `sparqly` bin — `nest-commander` entry point, dispatches `query` and `serve`.    |
| `apps/web`      | Angular app   | Browser playground (Angular 21 + Tailwind 4) hosting an embedded YASGUI.         |
| `libs/core`     | TypeScript    | Comunica wrapper, n3.js store, RDF loader, immutability guard.                   |
| `libs/domain`   | TypeScript    | DTOs and types shared between the server and the web app.                        |
| `libs/server`   | TypeScript    | NestJS HTTP module (`ServerModule`, `/api/sparql`) that only boots under `serve`. |

## Prerequisites

- Node **22+** (pinned to `24.15.0` via Volta; see `package.json`)
- pnpm **8+**

Node version is also enforced by `.npmrc` (`use-node-version=24.15.0`), so pnpm
subprocesses run against the same version regardless of what's on `$PATH`.

## Install

```sh
pnpm install
```

## Common tasks

```sh
pnpm exec nx run-many -t build lint test    # full workspace
pnpm exec nx build cli                       # build the sparqly CLI
pnpm exec nx test core                       # run core unit tests
pnpm exec nx serve web                       # Angular dev server (see below)
```

## Running the CLI locally

Build once, then invoke the bundle:

```sh
pnpm exec nx build cli
node dist/apps/cli/main.js --help
node dist/apps/cli/main.js query --help
node dist/apps/cli/main.js serve --help
```

Once published (`npm i -g sparqly`), the same entry point is exposed as the
`sparqly` bin.

## Dev server vs bundled-in-CLI

There are **two** ways to run the web UI, and they must not be confused.

### Dev: `nx serve web` + a running `sparqly serve`

During development the Angular app runs in its own dev server (fast rebuilds,
HMR). `sparqly serve` boots the HTTP API separately. The Angular dev server
must be configured to proxy `/api/*` to the running `sparqly serve` — do **not**
serve the dev bundle from the CLI.

```
┌─────────────┐   HTTP        ┌───────────────────┐
│  browser    │ ───────────▶  │ ng dev server     │
└─────────────┘               │  (Angular HMR)    │
                              │                   │
                              │  proxy /api/* ─▶  │ ──▶ sparqly serve (NestJS, :3000)
                              └───────────────────┘
```

### Prod: `sparqly serve` alone

For shipping, `apps/web` is built and its output is bundled **inside the CLI
package**. `sparqly serve` then serves both the static app at `/` and the
SPARQL endpoint at `/api/sparql` from a single process — no extra tooling
required after `npm i -g sparqly`.

```
┌─────────────┐   HTTP        ┌───────────────────────────────────────┐
│  browser    │ ───────────▶  │ sparqly serve (NestJS, :3000)         │
└─────────────┘               │   /             → Angular bundle       │
                              │   /api/sparql   → SPARQL Protocol      │
                              └───────────────────────────────────────┘
```

## License

MIT
