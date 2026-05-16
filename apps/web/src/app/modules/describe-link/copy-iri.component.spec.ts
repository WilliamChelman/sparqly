import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CopyIriComponent } from './copy-iri.component';

@Component({
  standalone: true,
  imports: [CopyIriComponent],
  template: `<app-copy-iri [iri]="iri" />`,
})
class Host {
  iri = 'http://example.org/alice';
}

function setup(iri: string) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.iri = iri;
  fixture.detectChanges();
  return fixture;
}

function buttonOf(fixture: { nativeElement: unknown }): HTMLButtonElement {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
    'button[data-testid="copy-iri"]',
  )!;
}

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', {
    value,
    configurable: true,
  });
}

describe('CopyIriComponent', () => {
  afterEach(() => {
    setClipboard(undefined);
  });

  it('writes the IRI to the clipboard and confirms on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    const fixture = setup('http://example.org/alice');
    const btn = buttonOf(fixture);
    expect(btn.querySelector('app-icon-copy')).toBeTruthy();
    expect(btn.querySelector('app-icon-check')).toBeNull();

    btn.click();
    await Promise.resolve();
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledWith('http://example.org/alice');
    expect(btn.querySelector('app-icon-check')).toBeTruthy();
    expect(btn.querySelector('app-icon-copy')).toBeNull();
  });

  it('does nothing when the Clipboard API is unavailable', () => {
    setClipboard(undefined);
    const fixture = setup('http://example.org/x');
    expect(() => buttonOf(fixture).click()).not.toThrow();
  });
});
