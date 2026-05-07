import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';

@Component({
  selector: 'app-yasgui-page',
  standalone: true,
  template: '<div data-testid="stub-yasgui"></div>',
})
class YasguiPageStub {}

@Component({
  selector: 'app-diff-page',
  standalone: true,
  template: '<div data-testid="stub-diff"></div>',
})
class DiffPageStub {}

describe('App routing', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([
          { path: '', component: YasguiPageStub },
          { path: 'diff', component: DiffPageStub },
        ]),
      ],
    }).compileComponents();
  });

  it('renders the Yasgui page on /', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid=stub-yasgui]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid=stub-diff]')).toBeFalsy();
  });

  it('renders the Diff page on /diff', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/diff');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid=stub-diff]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid=stub-yasgui]')).toBeFalsy();
  });

  it('exposes header nav links to / and /diff', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('header a'),
    ) as HTMLAnchorElement[];
    const hrefs = links.map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/');
    expect(hrefs).toContain('/diff');
  });
});
