import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
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
import type { FormatSerialization, PathStep } from 'common';
import type { Quad } from 'n3';
import { DescribeSectionsComponent } from './components/describe-sections.component';
import { describeIriExpand } from './utils/describe-iri-expand';
import { describeErrorMessage } from './utils/describe-error-message';
import type { DescribeBnodePathResult } from './utils/describe-bnode-path';
import { mergeDescribeSourceSlice } from './utils/merge-describe-source-slice';
import { stripDescribeResponse } from './utils/strip-describe-response';
import {
  DescribeService,
  type DescribeResponse,
} from './services/describe.service';

type DescribeTab = 'table' | 'turtle';

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
  ],
  template: `
    <header class="border-b border-border-muted bg-surface px-4 py-3">
      <h1 class="font-serif text-2xl italic text-foreground">describe</h1>
      <p class="text-sm text-foreground-muted">
        Resolve every quad about a seed IRI across the registry's glob sources.
      </p>
    </header>
    <main class="flex flex-col gap-3 p-4">
      <div class="flex flex-wrap items-start gap-2">
        <input
          type="text"
          aria-label="seed IRI"
          class="flex-1 rounded border border-border bg-surface px-2 py-1 font-mono text-sm text-foreground"
          placeholder="http://example.org/alice — or ex:alice"
          [value]="seed()"
          (input)="onSeedInput($any($event.target).value)"
          (keydown.enter)="run()"
        />
        <app-sources-picker
          label="source"
          [value]="initialSource()"
          (valueChange)="onSourceChange($event)"
        />
        <button
          app-btn
          variant="primary"
          type="button"
          [loading]="running()"
          [disabled]="seed().trim().length === 0"
          (click)="run()"
        >
          {{ running() ? 'running…' : 'Describe' }}
        </button>
      </div>
      @if (iriError(); as msg) {
        <p app-error-banner>{{ msg }}</p>
      }
      @if (describeError(); as msg) {
        <p app-error-banner data-testid="describe-error">{{ msg }}</p>
      }
      @if (running()) {
        <div class="text-sm text-foreground-faint">loading…</div>
      }
      @if (response(); as resp) {
        <section class="flex flex-col gap-2">
          <p class="text-sm text-foreground-muted">{{ resp.total }} quad(s).</p>
          <nav
            app-eyebrow
            role="tablist"
            class="flex gap-3.5 border-b border-border-muted"
          >
            <button
              role="tab"
              type="button"
              [attr.aria-selected]="activeTab() === 'table'"
              (click)="setTab('table')"
              class="cursor-pointer border-b border-transparent bg-transparent px-0 py-1 transition-colors duration-[180ms] hover:text-foreground-muted aria-selected:border-accent aria-selected:text-foreground"
            >
              table
            </button>
            @if (serialization(); as ser) {
              <button
                role="tab"
                type="button"
                [attr.aria-selected]="activeTab() === 'turtle'"
                (click)="setTab('turtle')"
                class="cursor-pointer border-b border-transparent bg-transparent px-0 py-1 transition-colors duration-[180ms] hover:text-foreground-muted aria-selected:border-accent aria-selected:text-foreground"
              >
                {{ ser }}
              </button>
            }
          </nav>
          @switch (activeTab()) {
            @case ('table') {
              <app-describe-sections
                [quads]="strippedQuads()"
                [originsByQuad]="originsByQuad()"
                [seed]="submittedSeed()"
                [context]="displayContext()"
                [source]="selectedSource()"
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
  /** Single error state for a failed describe (ADR-0052): the request now
   *  fails as one typed top-level error rather than per-source rows. */
  readonly describeError = signal<string | null>(null);
  readonly selectedSource = signal<string>('');
  readonly initialSource = signal<string>('');
  private prefixes: Record<string, string> = {};
  readonly displayContext = signal<DisplayContext>({ prefixes: {} });
  private readonly allEndpointSourceIds = signal<string[]>([]);
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
  private readonly strippedResponse = computed(() =>
    stripDescribeResponse(this.response()),
  );

  readonly strippedQuads = computed<readonly Quad[]>(
    () => this.strippedResponse().quads,
  );
  readonly originsByQuad = computed<ReadonlyMap<string, readonly string[]>>(
    () => this.strippedResponse().originsByQuad,
  );

  readonly formatted = computed<FormattedResult | null>(() => {
    const quads = this.strippedResponse().quads;
    if (quads.length === 0) return null;
    return resultToFormatted(
      quads as Quad[],
      {},
      undefined,
      this.displayContext(),
    );
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

    effect(() => {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { source: this.selectedSource() || null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
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
    this.describeError.set(null);
    this.submittedSeed.set(iri);
    this.expandedPaths = [];
    this.running.set(true);
    this.response.set(null);
    this._activeTab.set('table');
    const selected = this.selectedSource();

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { iri },
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
        // Describe fails as one typed top-level error (ADR-0052): surface its
        // message in the single error banner. No partial/in-payload data.
        const body = (err as { error?: unknown } | null)?.error;
        this.describeError.set(describeErrorMessage(body));
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
    if (this.expandedPaths.some((p) => JSON.stringify(p) === serialized))
      return;
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
          this.response.set(mergeDescribeSourceSlice(current, sourceId, fresh));
        },
        error: (err: unknown) => {
          this.running.set(false);
          const body = (err as { error?: unknown } | null)?.error;
          this.describeError.set(describeErrorMessage(body));
        },
      });
  }
}
