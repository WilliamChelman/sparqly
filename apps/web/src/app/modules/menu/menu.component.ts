import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CdkMenu } from '@angular/cdk/menu';

@Component({
  selector: 'app-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [CdkMenu],
  host: {
    class:
      'flex min-w-40 flex-col rounded-md border border-border bg-surface py-1 shadow-lg outline-none',
  },
  template: `<ng-content />`,
})
export class MenuComponent {}
