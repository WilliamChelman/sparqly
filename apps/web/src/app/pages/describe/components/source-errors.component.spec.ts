import { TestBed } from '@angular/core/testing';
import { SourceErrorsComponent } from './source-errors.component';
import type { DescribePerSourceEntry } from '../services/describe.service';

async function render(
  perSource: Record<string, DescribePerSourceEntry>,
): Promise<HTMLElement> {
  TestBed.configureTestingModule({ imports: [SourceErrorsComponent] });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(SourceErrorsComponent);
  fixture.componentRef.setInput('perSource', perSource);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('SourceErrorsComponent', () => {
  it('renders nothing when no source has an error', async () => {
    const root = await render({
      alpha: { count: 3, truncated: false },
      beta: { count: 0, truncated: false },
    });
    expect(root.querySelector('[data-testid=source-errors]')).toBeFalsy();
  });

  it('renders one row per failing source, sorted by id, showing id and message', async () => {
    const root = await render({
      zeta: { count: 0, truncated: false, error: 'zeta exploded' },
      alpha: { count: 5, truncated: false },
      beta: { count: 0, truncated: false, error: 'beta exploded' },
    });
    const rows = root.querySelectorAll('[data-testid=source-error-row]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('beta');
    expect(rows[0].textContent).toContain('beta exploded');
    expect(rows[1].textContent).toContain('zeta');
    expect(rows[1].textContent).toContain('zeta exploded');
    // Successful source is not listed.
    expect(root.textContent).not.toContain('alpha');
  });
});
