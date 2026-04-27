import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import Yasgui from '@triply/yasgui';

@Component({
  selector: 'app-yasgui-page',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  template: `
    <header class="border-b border-slate-200 bg-white px-4 py-3">
      <h1 class="text-lg font-semibold text-slate-900">sparqly playground</h1>
      <p class="text-sm text-slate-600">
        Querying <code class="rounded bg-slate-100 px-1 py-0.5">/api/sparql</code>
      </p>
    </header>
    <main class="flex-1 overflow-auto p-4">
      <div #host class="yasgui-host"></div>
    </main>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100vh;
      }
    `,
  ],
})
export class YasguiPage implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true })
  private host!: ElementRef<HTMLDivElement>;

  private instance: Yasgui | undefined;

  ngAfterViewInit(): void {
    Yasgui.defaults.requestConfig = {
      ...Yasgui.defaults.requestConfig,
      endpoint: '/api/sparql',
      method: 'POST',
    };
    Yasgui.defaults.copyEndpointOnNewTab = true;

    this.instance = new Yasgui(this.host.nativeElement, {
      requestConfig: { endpoint: '/api/sparql', method: 'POST' },
      copyEndpointOnNewTab: true,
    });
  }

  ngOnDestroy(): void {
    this.instance?.destroy();
  }
}
