import { getButtonClasses, type ButtonSize, type ButtonVariant } from './button.classes';

const VARIANTS: ReadonlyArray<ButtonVariant> = [
  'primary',
  'secondary',
  'accent',
  'pill',
  'ghost',
  'icon',
];
const SIZES: ReadonlyArray<ButtonSize> = ['sm', 'md'];

describe('getButtonClasses', () => {
  it('produces the golden class string for every variant × size', () => {
    const matrix: Record<string, string> = {};
    for (const v of VARIANTS) {
      for (const s of SIZES) {
        matrix[`${v}.${s}`] = getButtonClasses(v, s);
      }
    }
    expect(matrix).toMatchInlineSnapshot(`
      {
        "accent.md": "inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-md border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-surface transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
        "accent.sm": "inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-md border border-accent bg-accent px-2.5 py-1 text-[12px] font-medium text-surface transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
        "ghost.md": "inline-flex items-center justify-center gap-1.5 cursor-pointer bg-transparent px-2 py-1 text-[13px] text-foreground-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
        "ghost.sm": "inline-flex items-center justify-center gap-1.5 cursor-pointer bg-transparent px-1.5 py-0.5 text-[12px] text-foreground-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
        "icon.md": "inline-flex items-center justify-center gap-1.5 cursor-pointer border-0 bg-transparent p-0 leading-none text-foreground-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
        "icon.sm": "inline-flex items-center justify-center gap-1.5 cursor-pointer border-0 bg-transparent p-0 leading-none text-foreground-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
        "pill.md": "inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-full px-3 py-1.5 text-[13px] text-foreground-faint transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
        "pill.sm": "inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-full px-2.5 py-1 text-[12px] text-foreground-faint transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
        "primary.md": "inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground shadow-sm transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50",
        "primary.sm": "inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-full bg-accent px-3 py-1 text-[12px] font-medium text-accent-foreground shadow-sm transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50",
        "secondary.md": "inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-foreground transition-colors hover:border-foreground-faint disabled:cursor-not-allowed disabled:opacity-50",
        "secondary.sm": "inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] text-foreground transition-colors hover:border-foreground-faint disabled:cursor-not-allowed disabled:opacity-50",
      }
    `);
  });

  it('keeps the label at full opacity while loading by overriding disabled:opacity-50', () => {
    const loading = getButtonClasses('primary', 'md', true);
    expect(loading).toContain('disabled:opacity-100');
    expect(loading).not.toMatch(/disabled:opacity-50(?!\d)/);
  });
});
