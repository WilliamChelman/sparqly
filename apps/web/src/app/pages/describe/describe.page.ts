import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@app/modules/button';
import { ErrorBannerComponent } from '@app/modules/error-banner';
import { EyebrowComponent } from '@app/modules/eyebrow';
import { SourcesPickerComponent } from '@app/modules/sources-picker';
import { ConfigService, type DisplayContext } from '@app/core';
import { FormattedResultComponent } from '@app/pages/query/components/result/formatted-result.component';
import {
  resultToFormatted,
  type FormattedResult,
} from '@app/pages/query/utils/result-to-formatted';
import {
  describeProvenance,
  parseDescribeWire,
  serializeDescribeWire,
  type FormatSerialization,
  type PathStep,
} from 'common';
import type { Quad, Term } from 'n3';
import { DescribeSectionsComponent } from './components/describe-sections.component';
import { SourceErrorsComponent } from './components/source-errors.component';
import { describeIriExpand } from './utils/describe-iri-expand';
import type { DescribeBnodePathResult } from './utils/describe-bnode-path';
import {
  DescribeService,
  type DescribeResponse,
} from './services/describe.service';

type DescribeTab = 'table' | 'turtle';

const FROM_SOURCE_PREDICATE = 'urn:sparqly:fromSource';

@Component({
  selector: 'app-describe-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    DescribeSectionsComponent,
    ErrorBannerComponent,
    EyebrowComponent,
    FormattedResultComponent,
    SourcesPickerComponent,
    SourceErrorsComponent,
  ],
  template: `
    <header class="border-b border-border-muted bg-surface px-4 py-3">
      <h1 class="font-serif text-2xl italic text-foreground">describe</h1>
      <p class="text-sm text-foreground-muted">
        Resolve every quad about a seed IRI across the registry's glob sources.
      </p>
    </header>
    <main class="flex flex-col gap-3 p-4">
      <div class="flex flex-wrap items-center gap-2">
        <input
          data-testid="seed-input"
          type="text"
          class="flex-1 rounded border border-border bg-surface px-2 py-1 font-mono text-sm text-foreground"
          placeholder="http://example.org/alice — or ex:alice"
          [value]="seed()"
          (input)="onSeedInput($any($event.target).value)"
          (keydown.enter)="run()"
        />
        <app-sources-picker
          label="source"
          placeholder="All sources"
          [allowEmpty]="true"
          [value]="initialSource()"
          (valueChange)="onSourceChange($event)"
        />
        <button
          app-btn
          variant="primary"
          data-testid="run-describe"
          type="button"
          [loading]="running()"
          [disabled]="seed().trim().length === 0"
          (click)="run()"
        >
          {{ running() ? 'running…' : 'Describe' }}
        </button>
      </div>
      @if (iriError(); as msg) {
        <p app-error-banner data-testid="iri-error">
          {{ msg }}
        </p>
      }
      @if (running()) {
        <div data-testid="spinner" class="text-sm text-foreground-faint">
          loading…
        </div>
      }
      @if (response(); as resp) {
        <app-source-errors [perSource]="resp.perSource" />
        <section class="flex flex-col gap-2">
          <p class="text-sm text-foreground-muted">
            <span data-testid="describe-total">{{ resp.total }}</span> quad(s).
          </p>
          <nav
            app-eyebrow
            role="tablist"
            class="flex gap-3.5 border-b border-border-muted"
          >
            <button
              data-testid="tab-table"
              role="tab"
              type="button"
              [attr.aria-selected]="activeTab() === 'table'"
              (click)="setTab('table')"
              class="cursor-pointer border-b border-transparent bg-transparent px-0 py-1 transition-colors duration-[180ms] hover:text-foreground-muted aria-selected:border-accent aria-selected:text-foreground"
            >table</button>
            @if (serialization(); as ser) {
              <button
                [attr.data-testid]="'tab-' + ser"
                role="tab"
                type="button"
                [attr.aria-selected]="activeTab() === 'turtle'"
                (click)="setTab('turtle')"
                class="cursor-pointer border-b border-transparent bg-transparent px-0 py-1 transition-colors duration-[180ms] hover:text-foreground-muted aria-selected:border-accent aria-selected:text-foreground"
              >{{ ser }}</button>
            }
          </nav>
          @switch (activeTab()) {
            @case ('table') {
              <app-describe-sections
                [quads]="strippedQuads()"
                [originsByQuad]="originsByQuad()"
                [seed]="submittedSeed()"
                [context]="displayContext()"
                [endpointSourceIds]="endpointSourceIds()"
                (expand)="onExpand($event)"
              />
            }
            @case ('turtle') {
              @let f = formatted();
              @if (f) {
                <app-formatted-result
                  [body]="f.body"
                  [serialization]="f.serialization"
                />
              }
            }
          }
        </section>
      }
    </main>
  `,
})
export class DescribePage implements OnInit {
  private readonly describeService = inject(DescribeService);
  private readonly configService = inject(ConfigService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly seed = signal<string>('');
  readonly submittedSeed = signal<string>('');
  readonly running = signal<boolean>(false);
  readonly response = signal<DescribeResponse | null>(null);
  readonly iriError = signal<string | null>(null);
  // '' means "no override" — server fans out across the absorbed registry
  // (ADR-0033). A non-empty id describes against that source only.
  readonly selectedSource = signal<string>('');
  readonly initialSource = signal<string>('');
  private prefixes: Record<string, string> = {};
  readonly displayContext = signal<DisplayContext>({ prefixes: {} });
  /** Ids of every `endpoint` source in the served registry. */
  private readonly allEndpointSourceIds = signal<string[]>([]);
  /**
   * Endpoint-source ids that can be expanded *right now*. Under ADR-0033's
   * single-or-all contract, `expandedPaths` is scoped to the currently
   * selected source — so the expand affordance is gated on that source
   * being set *and* being an endpoint. When no source (or a non-endpoint
   * source) is selected, the affordance is hidden everywhere.
   */
  readonly endpointSourceIds = computed<readonly string[]>(() => {
    const selected = this.selectedSource();
    if (selected === '') return [];
    return this.allEndpointSourceIds().includes(selected) ? [selected] : [];
  });
  /**
   * UI-driven blank-node expansion paths against the selected endpoint source
   * (ADR-0019, ADR-0033). A single flat array — the request carries one
   * source per call, so per-source keying is no longer needed. Lives only in
   * component state — the URL keeps carrying just the seed and source.
   */
  private expandedPaths: PathStep[][] = [];

  private readonly _activeTab = signal<DescribeTab>('table');
  readonly activeTab = this._activeTab.asReadonly();

  /** Stripped describe quads + origins map, shared by the table tab and the
   *  turtle/trig tab so wire parsing happens once per response. */
  private readonly strippedResponse = computed<{
    quads: readonly Quad[];
    originsByQuad: ReadonlyMap<string, readonly string[]>;
  }>(() => {
    const resp = this.response();
    if (!resp || resp.quads.trim().length === 0) {
      return { quads: [], originsByQuad: new Map() };
    }
    const all = parseDescribeWire(resp.quads);
    const { quads, originsByQuad } = describeProvenance.strip(
      all,
      FROM_SOURCE_PREDICATE,
    );
    return { quads, originsByQuad };
  });

  readonly strippedQuads = computed<readonly Quad[]>(
    () => this.strippedResponse().quads,
  );
  readonly originsByQuad = computed<ReadonlyMap<string, readonly string[]>>(
    () => this.strippedResponse().originsByQuad,
  );

  readonly formatted = computed<FormattedResult | null>(() => {
    const quads = this.strippedResponse().quads;
    if (quads.length === 0) return null;
    return resultToFormatted(quads as Quad[], {}, undefined, this.displayContext());
  });

  readonly serialization = computed<FormatSerialization | null>(
    () => this.formatted()?.serialization ?? null,
  );

  constructor() {
    const iri = this.route.snapshot.queryParamMap.get('iri');
    if (iri !== null) this.seed.set(iri);
    const source = this.route.snapshot.queryParamMap.get('source');
    if (source !== null && source !== '') {
      this.selectedSource.set(source);
      this.initialSource.set(source);
    }
  }

  ngOnInit(): void {
    this.configService.config().subscribe((config) => {
      this.prefixes = config.context.prefixes;
      this.displayContext.set(config.context);
      this.allEndpointSourceIds.set(
        config.sources.filter((s) => s.kind === 'endpoint').map((s) => s.id),
      );
      // A URL carrying ?iri is a bookmark — rehydrate and run immediately.
      if (this.seed().trim().length > 0) this.run();
    });
  }

  onSeedInput(value: string): void {
    this.seed.set(value);
    this.iriError.set(null);
  }

  onSourceChange(value: string): void {
    this.selectedSource.set(value);
  }

  setTab(tab: DescribeTab): void {
    this._activeTab.set(tab);
  }

  run(): void {
    const expanded = describeIriExpand(this.seed(), this.prefixes);
    if (!expanded.ok) {
      this.iriError.set(expanded.error);
      return;
    }
    const iri = expanded.iri;
    this.iriError.set(null);
    this.submittedSeed.set(iri);
    this.expandedPaths = [];
    this.running.set(true);
    this.response.set(null);
    this._activeTab.set('table');
    const selected = this.selectedSource();
    const queryParams: Record<string, string | null> = {
      iri,
      // Always write the key so a previously-selected source clears from the URL
      // when the picker is back to "All sources".
      source: selected === '' ? null : selected,
    };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    const req: { iri: string; source?: string } = { iri };
    if (selected !== '') req.source = selected;
    this.describeService.run(req).subscribe({
      next: (resp) => {
        this.running.set(false);
        this.response.set(resp);
      },
      error: (err: unknown) => {
        this.running.set(false);
        // `/api/describe` returns 502 with the same response shape (per-source
        // error map, empty quads) when every selected source failed — surface
        // it so the error rows still render.
        const body = (err as { error?: unknown } | null)?.error;
        if (
          body !== null &&
          typeof body === 'object' &&
          'perSource' in (body as Record<string, unknown>)
        ) {
          this.response.set(body as DescribeResponse);
        }
      },
    });
  }

  /**
   * Expand a dangling blank node one hop deeper (ADR-0019, ADR-0033). Append
   * its predicate-pinned path to `expandedPaths` and re-call `/api/describe`
   * against the currently selected endpoint source alone; splice the fresh
   * slice into the merged view. Affordance gating upstream guarantees a
   * non-empty selected source whose kind is `endpoint`, so the bnode's
   * origin source always matches the selection.
   */
  onExpand(target: DescribeBnodePathResult): void {
    const current = this.response();
    if (current === null) return;
    const { sourceId, path } = target;
    const serialized = JSON.stringify(path);
    if (this.expandedPaths.some((p) => JSON.stringify(p) === serialized)) return;
    this.expandedPaths = [...this.expandedPaths, path];
    this.running.set(true);
    this.describeService
      .run({
        iri: this.submittedSeed(),
        source: sourceId,
        expandedPaths: this.expandedPaths,
      })
      .subscribe({
        next: (fresh) => {
          this.running.set(false);
          this.response.set(this.mergeSourceSlice(current, sourceId, fresh));
        },
        error: () => {
          this.running.set(false);
        },
      });
  }

  /**
   * Rebuild the merged describe view with `sourceId`'s quads taken wholesale
   * from `fresh` and every other source's quads kept from `current`. The wire
   * carries one `fromSource` annotation per (quad, origin), so per-source slices
   * are recoverable from `current` by inspecting those annotations.
   */
  private mergeSourceSlice(
    current: DescribeResponse,
    sourceId: string,
    fresh: DescribeResponse,
  ): DescribeResponse {
    const predicate = FROM_SOURCE_PREDICATE;
    const slices = new Map<string, Map<string, Quad>>();
    const currentAll =
      current.quads.trim().length === 0 ? [] : parseDescribeWire(current.quads);
    const stripped = describeProvenance.strip(currentAll, predicate);
    for (const q of stripped.quads) {
      const key = quadKey(q);
      for (const origin of stripped.originsByQuad.get(key) ?? []) {
        if (origin === sourceId) continue; // replaced wholesale below
        let m = slices.get(origin);
        if (!m) {
          m = new Map();
          slices.set(origin, m);
        }
        if (!m.has(key)) m.set(key, q);
      }
    }
    const freshAll =
      fresh.quads.trim().length === 0 ? [] : parseDescribeWire(fresh.quads);
    const freshSlice = new Map<string, Quad>();
    for (const q of describeProvenance.strip(freshAll, predicate).quads) {
      const key = quadKey(q);
      if (!freshSlice.has(key)) freshSlice.set(key, q);
    }
    slices.set(sourceId, freshSlice);

    const orderedSources = Object.keys(current.perSource);
    if (!orderedSources.includes(sourceId)) orderedSources.push(sourceId);
    const merged = new Map<string, Quad>();
    const originsByQuad = new Map<string, string[]>();
    for (const src of orderedSources) {
      const m = slices.get(src);
      if (!m) continue;
      for (const [key, q] of m) {
        if (!merged.has(key)) merged.set(key, q);
        const list = originsByQuad.get(key);
        if (list) {
          if (!list.includes(src)) list.push(src);
        } else {
          originsByQuad.set(key, [src]);
        }
      }
    }
    const annotations: Quad[] = [];
    for (const [key, q] of merged) {
      for (const origin of originsByQuad.get(key) ?? []) {
        annotations.push(
          ...describeProvenance.inject([q], origin, predicate).slice(1),
        );
      }
    }
    const quads = serializeDescribeWire([...merged.values(), ...annotations]);
    const perSource = { ...current.perSource };
    const freshEntry = fresh.perSource[sourceId];
    if (freshEntry) perSource[sourceId] = freshEntry;
    return { iri: current.iri, quads, total: merged.size, perSource };
  }
}

function quadKey(q: Quad): string {
  return `${termKey(q.subject)} ${termKey(q.predicate)} ${termKey(q.object)} ${termKey(q.graph)}`;
}

function termKey(t: Term): string {
  if ((t.termType as string) === 'Quad') {
    return `<<${quadKey(t as unknown as Quad)}>>`;
  }
  return `${t.termType}:${t.value}`;
}
