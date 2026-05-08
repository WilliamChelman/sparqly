import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import Yasgui from '@triply/yasgui';

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
  private currentValue = '';

  @Input()
  set value(v: string) {
    const next = v ?? '';
    this.currentValue = next;
    if (this.instance && this.instance['getValue']() !== next) {
      this.instance['setValue'](next);
    }
  }
  get value(): string {
    return this.currentValue;
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
    this.instance['setValue'](this.currentValue);
    this.instance.on('change', () => {
      const v = (this.instance?.['getValue']() as string) ?? '';
      if (v !== this.currentValue) {
        this.currentValue = v;
        this.valueChange.emit(v);
      }
    });
  }

  getQueryType(): string | undefined {
    if (!this.instance) return undefined;
    try {
      const t = (this.instance as unknown as { getQueryType: () => unknown }).getQueryType();
      return typeof t === 'string' ? t : undefined;
    } catch {
      return undefined;
    }
  }

  ngOnDestroy(): void {
    this.instance?.destroy();
  }
}
