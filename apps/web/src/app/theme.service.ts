import {
  computed,
  DOCUMENT,
  inject,
  Injectable,
  signal,
} from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'sparqly:theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly modeSignal = signal<ThemeMode>('system');
  private readonly systemPrefersDark = signal<boolean>(false);

  readonly mode = this.modeSignal.asReadonly();
  readonly resolved = computed<ResolvedTheme>(() => {
    const m = this.modeSignal();
    if (m === 'light' || m === 'dark') return m;
    return this.systemPrefersDark() ? 'dark' : 'light';
  });

  constructor() {
    const initial = readStoredMode();
    this.modeSignal.set(initial);
    this.doc.documentElement.setAttribute('data-theme', initial);

    const win = this.doc.defaultView ?? window;
    const mql = win?.matchMedia?.(DARK_QUERY);
    if (mql) {
      this.systemPrefersDark.set(mql.matches);
      mql.addEventListener('change', (ev) => {
        this.systemPrefersDark.set(ev.matches);
      });
    }

    win?.addEventListener('storage', (ev: StorageEvent) => {
      if (ev.key !== STORAGE_KEY) return;
      const next: ThemeMode =
        ev.newValue === 'light' || ev.newValue === 'dark'
          ? ev.newValue
          : 'system';
      this.modeSignal.set(next);
      this.doc.documentElement.setAttribute('data-theme', next);
    });
  }

  set(mode: ThemeMode): void {
    this.modeSignal.set(mode);
    this.doc.documentElement.setAttribute('data-theme', mode);
    if (mode === 'system') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, mode);
    }
  }
}

function readStoredMode(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}
