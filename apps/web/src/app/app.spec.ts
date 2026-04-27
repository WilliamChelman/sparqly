import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { YasguiPage } from './yasgui-page';

@Component({
  selector: 'app-yasgui-page',
  standalone: true,
  template: '<div data-testid="stub-yasgui"></div>',
})
class YasguiPageStub {}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] })
      .overrideComponent(App, {
        remove: { imports: [YasguiPage] },
        add: { imports: [YasguiPageStub] },
      })
      .compileComponents();
  });

  it('mounts the YASGUI page', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-yasgui-page')).toBeTruthy();
  });
});
