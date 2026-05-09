import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AppComponent } from './app.component';

@Component({
  selector: 'app-query-page',
  standalone: true,
  template: '<div data-testid="stub-query"></div>',
})
class QueryPageStub {}

@Component({
  selector: 'app-diff-page',
  standalone: true,
  template: '<div data-testid="stub-diff"></div>',
})
class DiffPageStub {}

describe('AppComponent routing', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([
          { path: '', component: QueryPageStub },
          { path: 'diff', component: DiffPageStub },
        ]),
      ],
    }).compileComponents();
  });

  it('renders the Query page on /', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid=stub-query]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid=stub-diff]')).toBeFalsy();
  });

  it('renders the Diff page on /diff', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/diff');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid=stub-diff]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid=stub-query]')).toBeFalsy();
  });

  it('exposes header nav links to / and /diff', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('header a'),
    ) as HTMLAnchorElement[];
    const hrefs = links.map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/');
    expect(hrefs).toContain('/diff');
  });

  it('renders the theme toggle in the header', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const header = (fixture.nativeElement as HTMLElement).querySelector(
      'header',
    );
    expect(header?.querySelector('app-theme-toggle')).toBeTruthy();
  });

  it('renders the constellation logomark inside the brand link', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const brand = (fixture.nativeElement as HTMLElement).querySelector(
      'header a[routerLink="/"], header a[href="/"]',
    );
    expect(brand?.querySelector('app-logomark')).toBeTruthy();
  });

  it('renders the header-drift ambient animation', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const header = (fixture.nativeElement as HTMLElement).querySelector(
      'header',
    );
    expect(header?.querySelector('app-header-drift')).toBeTruthy();
  });
});
