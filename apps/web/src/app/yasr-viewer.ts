import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import Yasgui from '@triply/yasgui';

type YasrInstance = InstanceType<typeof Yasgui.Yasr>;

@Component({
  selector: 'app-yasr-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `<div #host class="yasr-viewer-host"></div>`,
})
export class YasrViewer implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true })
  private host!: ElementRef<HTMLDivElement>;

  private instance: YasrInstance | undefined;
  private pending: unknown = null;

  @Input() set result(r: unknown) {
    this.pending = r;
    if (this.instance && r != null) {
      (this.instance as unknown as { setResponse: (r: unknown) => void }).setResponse(r);
    }
  }

  ngAfterViewInit(): void {
    const Yasr = Yasgui.Yasr;
    this.instance = new Yasr(this.host.nativeElement, { persistenceId: null });
    if (this.pending != null) {
      (this.instance as unknown as { setResponse: (r: unknown) => void }).setResponse(
        this.pending,
      );
    }
  }

  ngOnDestroy(): void {
    this.instance?.destroy();
  }
}
