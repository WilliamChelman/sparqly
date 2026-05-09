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
import Yasgui from '@triply/yasgui';
import {
  countPrefixes,
  detectQueryType,
  type QueryType,
} from './query-detection';

type YasqeInstance = InstanceType<typeof Yasgui.Yasqe>;

@Component({
  selector: 'app-yasqe-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `<div #host class="yasqe-editor-host"></div>`,
})
export class YasqeEditor implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true })
  private host!: ElementRef<HTMLDivElement>;

  private instance: YasqeInstance | undefined;
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
    const Yasqe = Yasgui.Yasqe;
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
  }

  ngOnDestroy(): void {
    this.instance?.destroy();
  }
}
