export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'pill'
  | 'ghost'
  | 'icon';
export type ButtonSize = 'sm' | 'md';

const BASE = 'inline-flex items-center justify-center gap-1.5 cursor-pointer';
const DISABLED = 'disabled:cursor-not-allowed disabled:opacity-50';

const PRIMARY_SHAPE =
  'rounded-full bg-accent {{PAD}} {{TEXT}} font-medium text-accent-foreground shadow-sm transition-colors hover:bg-accent-strong';
const SECONDARY_SHAPE =
  'rounded-md border border-border bg-surface {{PAD}} {{TEXT}} text-foreground transition-colors hover:border-foreground-faint';
const ACCENT_SHAPE =
  'rounded-md border border-accent bg-accent {{PAD}} {{TEXT}} font-medium text-surface transition-colors hover:opacity-90';
const PILL_SHAPE =
  'rounded-full {{PAD}} {{TEXT}} text-foreground-faint transition-colors hover:text-foreground';
const GHOST_SHAPE =
  'bg-transparent {{PAD}} {{TEXT}} text-foreground-muted transition-colors hover:text-foreground';
const ICON_SHAPE =
  'border-0 bg-transparent {{PAD}} leading-none text-foreground-muted transition-colors hover:text-foreground';

interface SizeSpec {
  readonly pad: string;
  readonly text: string;
}

const SIZES: Record<ButtonVariant, Record<ButtonSize, SizeSpec>> = {
  primary: {
    sm: { pad: 'px-3 py-1', text: 'text-[12px]' },
    md: { pad: 'px-4 py-1.5', text: 'text-sm' },
  },
  secondary: {
    sm: { pad: 'px-2.5 py-1', text: 'text-[12px]' },
    md: { pad: 'px-3 py-1.5', text: 'text-[13px]' },
  },
  accent: {
    sm: { pad: 'px-2.5 py-1', text: 'text-[12px]' },
    md: { pad: 'px-3 py-1.5', text: 'text-[13px]' },
  },
  pill: {
    sm: { pad: 'px-2.5 py-1', text: 'text-[12px]' },
    md: { pad: 'px-3 py-1.5', text: 'text-[13px]' },
  },
  ghost: {
    sm: { pad: 'px-1.5 py-0.5', text: 'text-[12px]' },
    md: { pad: 'px-2 py-1', text: 'text-[13px]' },
  },
  icon: {
    sm: { pad: 'p-0', text: '' },
    md: { pad: 'p-0', text: '' },
  },
};

const SHAPES: Record<ButtonVariant, string> = {
  primary: PRIMARY_SHAPE,
  secondary: SECONDARY_SHAPE,
  accent: ACCENT_SHAPE,
  pill: PILL_SHAPE,
  ghost: GHOST_SHAPE,
  icon: ICON_SHAPE,
};

export function getButtonClasses(
  variant: ButtonVariant,
  size: ButtonSize,
  loading?: boolean,
): string {
  const { pad, text } = SIZES[variant][size];
  const shape = SHAPES[variant].replace('{{PAD}}', pad).replace('{{TEXT}}', text);
  const disabledClasses = loading
    ? 'disabled:cursor-not-allowed disabled:opacity-100'
    : DISABLED;
  return `${BASE} ${shape} ${disabledClasses}`;
}
