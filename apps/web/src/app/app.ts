import { Component } from '@angular/core';
import { YasguiPage } from './yasgui-page';

@Component({
  imports: [YasguiPage],
  selector: 'app-root',
  template: '<app-yasgui-page />',
})
export class App {}
