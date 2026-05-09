import { TestBed } from '@angular/core/testing';
import { LogomarkComponent } from './logomark.component';

describe('LogomarkComponent', () => {
  it('renders an SVG with the constellation path and accent stars', () => {
    const fixture = TestBed.createComponent(LogomarkComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const svg = el.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.querySelector('path')).toBeTruthy();
    expect(svg?.querySelectorAll('circle').length).toBeGreaterThan(0);
  });
});
