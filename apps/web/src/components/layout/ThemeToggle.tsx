import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Light/dark theme toggle (ui.md §Dark mode). Tailwind is class-based
 * (`darkMode: ['class']`), so this toggles the `dark` class on <html> and
 * persists the choice. The initial class is set by a tiny boot script in
 * index.html (no flash of the wrong theme); this control mirrors + flips it.
 */
const STORAGE_KEY = 'lms-theme';

function isDarkNow(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

export function ThemeToggle(): JSX.Element {
  const [dark, setDark] = useState<boolean>(isDarkNow);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
    } catch {
      /* storage unavailable (private mode) — the toggle still works in-session */
    }
  }, [dark]);

  return (
    <Button
      variant="outline"
      size="icon"
      className="h-9 w-9"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={dark}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setDark((v) => !v)}
    >
      {dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
    </Button>
  );
}
