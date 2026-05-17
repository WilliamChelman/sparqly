import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HeaderComponent } from './header.component';

describe('HeaderComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('exposes nav links to /, /diff, /describe and /queries', () => {
    const el = render();
    const hrefs = Array.from(el.querySelectorAll('nav a')).map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toContain('/');
    expect(hrefs).toContain('/diff');
    expect(hrefs).toContain('/describe');
    expect(hrefs).toContain('/queries');
  });

  it('renders the constellation logomark inside the brand link', () => {
    const el = render();
    const brand = el.querySelector(
      'a[routerLink="/"], a[href="/"]',
    );
    expect(brand?.querySelector('app-logomark')).toBeTruthy();
  });

  it('renders the theme toggle', () => {
    const el = render();
    expect(el.querySelector('app-theme-toggle')).toBeTruthy();
  });
});
