import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  Signal,
  ViewChild,
  ViewEncapsulation,
  computed,
  signal,
} from '@angular/core';
import Yasqe from '@triply/yasqe';
import {
  countPrefixes,
  detectQueryType,
  type QueryType,
} from '@app/core';

type YasqeInstance = InstanceType<typeof Yasqe>;

@Component({
  selector: 'app-yasqe-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `<div #host class="yasqe-editor-host"></div>`,
  styles: [
    `
      :host {
        display: block;
        min-height: 8rem;
      }
      .yasqe-editor-host {
        height: 100%;
      }
      .yasqe-editor-host .yasqe {
        background: var(--bg-elevated);
        color: var(--ink);
        font-family: var(--font-mono);
      }
      .yasqe_share,
      .yasqe_sharePopup,
      .yasqe_buttons {
        display: none !important;
      }
    `,
  ],
})
export class YasqeEditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true })
  private host!: ElementRef<HTMLDivElement>;

  private instance: YasqeInstance | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private readonly valueSignal = signal('');

  readonly queryType: Signal<QueryType | undefined> = computed(() =>
    detectQueryType(this.valueSignal()),
  );
  readonly prefixCount: Signal<number> = computed(() =>
    countPrefixes(this.valueSignal()),
  );

  @Input()
  set value(v: string) {
    const next = v ?? '';
    this.valueSignal.set(next);
    if (this.instance && this.instance['getValue']() !== next) {
      this.instance['setValue'](next);
    }
  }
  get value(): string {
    return this.valueSignal();
  }

  @Output() valueChange = new EventEmitter<string>();

  ngAfterViewInit(): void {
    this.instance = new Yasqe(this.host.nativeElement, {
      showQueryButton: false,
      resizeable: false,
      persistenceId: null,
      requestConfig: { endpoint: '/api/sparql' },
    });
    const cm = this.instance as unknown as {
      setOption?: (name: string, value: unknown) => void;
    };
    cm.setOption?.('theme', 'sparqly');
    this.instance['setValue'](this.valueSignal());
    this.instance.on('change', () => {
      const v = (this.instance?.['getValue']() as string) ?? '';
      if (v !== this.valueSignal()) {
        this.valueSignal.set(v);
        this.valueChange.emit(v);
      }
    });
    const syncSize = () => {
      const height = this.host.nativeElement.clientHeight;
      if (height <= 0) return;
      const cm = this.instance as unknown as {
        setSize?: (w: number | string | null, h: number | string | null) => void;
        refresh?: () => void;
      };
      cm.setSize?.(null, height);
      cm.refresh?.();
    };
    syncSize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(syncSize);
      this.resizeObserver.observe(this.host.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.instance?.destroy();
  }
}
