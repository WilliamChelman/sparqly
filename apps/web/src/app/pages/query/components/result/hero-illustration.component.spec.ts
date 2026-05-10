import { TestBed } from '@angular/core/testing';
import { HeroIllustrationComponent } from './hero-illustration.component';

describe('HeroIllustration', () => {
  it('renders an SVG', () => {
    const fixture = TestBed.createComponent(HeroIllustrationComponent);
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');
    expect(svg).toBeTruthy();
  });
});
