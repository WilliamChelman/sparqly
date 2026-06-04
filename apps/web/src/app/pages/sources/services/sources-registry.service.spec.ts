import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { describe, expect, it } from 'vitest';
import type { SourceRow } from '../models/source-row';
import {
  SOURCE_STATE_STREAM_FACTORY,
  type SourceStateStream,
  type SourceStateStreamFactory,
  type SourceStateStreamHandlers,
} from './source-state-stream';
import { SourcesRegistryService } from './sources-registry.service';

const SNAPSHOT: SourceRow[] = [
  { mode: 'in-memory', id: 'docs', kind: 'glob', state: 'not-loaded' },
  {
    mode: 'in-memory',
    id: 'projects',
    kind: 'glob',
    state: 'loaded',
    default: true,
  },
];

interface FakeStream {
  factory: SourceStateStreamFactory;
  emitRow: (row: SourceRow) => void;
  emitRefetchSnapshot: () => void;
  closed: () => boolean;
  openCount: () => number;
}

function createFakeStream(): FakeStream {
  let handlers: SourceStateStreamHandlers | undefined;
  let closed = false;
  let openCount = 0;
  const factory: SourceStateStreamFactory = {
    open(h): SourceStateStream {
      handlers = h;
      openCount += 1;
      closed = false;
      return {
        close: () => {
          closed = true;
          handlers = undefined;
        },
      };
    },
  };
  return {
    factory,
    emitRow: (row) => handlers?.onRow(row),
    emitRefetchSnapshot: () => handlers?.onRefetchSnapshot(),
    closed: () => closed,
    openCount: () => openCount,
  };
}

function setup(options: { stream?: FakeStream } = {}) {
  const stream = options.stream ?? createFakeStream();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SOURCE_STATE_STREAM_FACTORY, useValue: stream.factory },
      SourcesRegistryService,
    ],
  });
  const service = TestBed.inject(SourcesRegistryService);
  const http = TestBed.inject(HttpTestingController);
  return { service, http, stream };
}

function flushSnapshot(
  http: HttpTestingController,
  rows: SourceRow[] = SNAPSHOT,
): void {
  const req = http.expectOne('/api/sources');
  expect(req.request.method).toBe('GET');
  req.flush(rows);
}

function flushConfig(
  http: HttpTestingController,
  opts: { allowAdminActions?: boolean } = {},
): void {
  const req = http.expectOne('/api/config');
  req.flush({
    sources: [],
    context: { prefixes: {} },
    describe: {
      perSourceSoftLimit: 0,
      perSourceHardLimit: 0,
    },
    sourcesAdmin: { allowAdminActions: opts.allowAdminActions ?? true },
  });
}

describe('SourcesRegistryService', () => {
  it('starts with null rows until the snapshot resolves', () => {
    const { service, http } = setup();
    expect(service.rows()).toBeNull();
    flushSnapshot(http);
    flushConfig(http);
    expect(service.rows()?.map((r) => r.id)).toEqual(['docs', 'projects']);
  });

  it('preserves the `default` flag from the snapshot', () => {
    const { service, http } = setup();
    flushSnapshot(http);
    flushConfig(http);
    const projects = service.rows()?.find((r) => r.id === 'projects');
    expect(projects?.default).toBe(true);
  });

  it('leaves `rows` null if the snapshot request errors', () => {
    const { service, http } = setup();
    const req = http.expectOne('/api/sources');
    req.error(new ProgressEvent('error'), { status: 500, statusText: 'boom' });
    flushConfig(http);
    expect(service.rows()).toBeNull();
  });

  it('opens the SSE stream once the snapshot resolves', () => {
    const stream = createFakeStream();
    const { http } = setup({ stream });
    expect(stream.openCount()).toBe(0);
    flushSnapshot(http);
    flushConfig(http);
    expect(stream.openCount()).toBe(1);
  });

  it('replaces a known row in place when onRow fires', () => {
    const stream = createFakeStream();
    const { service, http } = setup({ stream });
    flushSnapshot(http);
    flushConfig(http);
    stream.emitRow({
      mode: 'in-memory',
      id: 'docs',
      kind: 'glob',
      state: 'loaded',
    });
    const docs = service.rows()?.find((r) => r.id === 'docs');
    if (docs?.mode === 'endpoint' || docs === undefined) {
      throw new Error('expected in-memory docs row');
    }
    expect(docs.state).toBe('loaded');
  });

  it('appends an onRow event whose id is not in the snapshot', () => {
    const stream = createFakeStream();
    const { service, http } = setup({ stream });
    flushSnapshot(http);
    flushConfig(http);
    stream.emitRow({
      mode: 'in-memory',
      id: 'extra',
      kind: 'glob',
      state: 'loaded',
    });
    expect(service.rows()?.map((r) => r.id)).toEqual([
      'docs',
      'projects',
      'extra',
    ]);
  });

  it('preserves the existing children array when a meta-row event arrives', () => {
    const stream = createFakeStream();
    const child: SourceRow = {
      mode: 'in-memory',
      id: 'docs/a.ttl',
      kind: 'file',
      state: 'loaded',
      parentId: 'docs',
    };
    const { service, http } = setup({ stream });
    flushSnapshot(http, [
      {
        mode: 'in-memory',
        id: 'docs',
        kind: 'glob',
        state: 'mixed',
        children: [child],
      },
    ]);
    flushConfig(http);
    stream.emitRow({
      mode: 'in-memory',
      id: 'docs',
      kind: 'glob',
      state: 'loaded',
    });
    const docs = service.rows()?.[0];
    if (docs === undefined || docs.mode === 'endpoint') {
      throw new Error('expected in-memory docs row');
    }
    expect(docs.state).toBe('loaded');
    expect(docs.children).toEqual([child]);
  });

  it('re-aggregates the parent when a child event fires (state + sums)', () => {
    const stream = createFakeStream();
    const LOADED_AT = 1_700_000_000_000;
    const { service, http } = setup({ stream });
    flushSnapshot(http, [
      {
        mode: 'in-memory',
        id: 'docs',
        kind: 'glob',
        state: 'loaded',
        children: [
          {
            mode: 'in-memory',
            id: 'docs/a.ttl',
            kind: 'file',
            state: 'loaded',
            parentId: 'docs',
            quads: 10,
            files: 1,
            loadedAt: LOADED_AT,
          },
          {
            mode: 'in-memory',
            id: 'docs/b.ttl',
            kind: 'file',
            state: 'loaded',
            parentId: 'docs',
            quads: 7,
            files: 1,
            loadedAt: LOADED_AT,
          },
        ],
      },
    ]);
    flushConfig(http);

    // Child flips to not-loaded → parent goes `mixed`, sums drop b's contribution.
    stream.emitRow({
      mode: 'in-memory',
      id: 'docs/b.ttl',
      kind: 'file',
      state: 'not-loaded',
      parentId: 'docs',
    });
    const docs = service.rows()?.[0];
    if (docs === undefined || docs.mode === 'endpoint') {
      throw new Error('expected in-memory docs row');
    }
    expect(docs.state).toBe('mixed');
    expect(docs.quads).toBe(10);
    expect(docs.files).toBe(1);
    expect(docs.loadedAt).toBe(LOADED_AT);
  });

  it('appends an unknown child under its parent', () => {
    const stream = createFakeStream();
    const { service, http } = setup({ stream });
    flushSnapshot(http, [
      {
        mode: 'in-memory',
        id: 'docs',
        kind: 'glob',
        state: 'mixed',
        children: [
          {
            mode: 'in-memory',
            id: 'docs/a.ttl',
            kind: 'file',
            state: 'loaded',
            parentId: 'docs',
          },
        ],
      },
    ]);
    flushConfig(http);
    stream.emitRow({
      mode: 'in-memory',
      id: 'docs/b.ttl',
      kind: 'file',
      state: 'loaded',
      parentId: 'docs',
    });
    const docs = service.rows()?.[0];
    if (docs === undefined || docs.mode === 'endpoint') {
      throw new Error('expected in-memory docs row');
    }
    expect(docs.children?.map((c) => c.id)).toEqual([
      'docs/a.ttl',
      'docs/b.ttl',
    ]);
  });

  it('drops a child event whose parentId is unknown', () => {
    const stream = createFakeStream();
    const { service, http } = setup({ stream });
    flushSnapshot(http);
    flushConfig(http);
    const before = service.rows();
    stream.emitRow({
      mode: 'in-memory',
      id: 'ghost/a.ttl',
      kind: 'file',
      state: 'loaded',
      parentId: 'ghost',
    });
    expect(service.rows()).toEqual(before);
  });

  it('refetches the snapshot and re-opens the stream on refetch-snapshot', () => {
    const stream = createFakeStream();
    const { service, http } = setup({ stream });
    flushSnapshot(http);
    flushConfig(http);
    expect(stream.openCount()).toBe(1);

    stream.emitRefetchSnapshot();
    expect(stream.closed()).toBe(true);

    const second: SourceRow[] = [
      { mode: 'in-memory', id: 'docs', kind: 'glob', state: 'loaded' },
    ];
    flushSnapshot(http, second);
    expect(service.rows()?.map((r) => r.id)).toEqual(['docs']);
    expect(stream.openCount()).toBe(2);
  });

  it('reads allowAdminActions from /api/config', () => {
    const { service, http } = setup();
    flushSnapshot(http);
    flushConfig(http, { allowAdminActions: false });
    expect(service.allowAdminActions()).toBe(false);
  });

  it('defaults allowAdminActions to true before /api/config resolves', () => {
    const { service, http } = setup();
    expect(service.allowAdminActions()).toBe(true);
    flushSnapshot(http);
    flushConfig(http);
  });
});
