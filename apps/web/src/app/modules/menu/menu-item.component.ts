/* eslint-disable @angular-eslint/component-selector */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CdkMenuItem } from '@angular/cdk/menu';

@Component({
  selector: 'button[app-menu-item]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [{ directive: CdkMenuItem, outputs: ['cdkMenuItemTriggered'] }],
  host: {
    type: 'button',
    class:
      'flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[13px] text-foreground-muted hover:bg-surface-sunken hover:text-foreground focus:bg-surface-sunken focus:text-foreground focus:outline-none',
  },
  template: `<ng-content />`,
})
export class MenuItemComponent {}
