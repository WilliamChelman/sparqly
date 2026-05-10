import { TestBed } from '@angular/core/testing';
import { ErrorConstellationComponent } from './error-constellation.component';

describe('ErrorConstellation', () => {
  it('renders an SVG', () => {
    const fixture = TestBed.createComponent(ErrorConstellationComponent);
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');
    expect(svg).toBeTruthy();
  });
});
