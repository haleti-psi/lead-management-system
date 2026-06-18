import { useEffect, useRef, useState } from 'react';

/**
 * Animate a number from its previous value to `value` with requestAnimationFrame
 * (easeOutCubic). Returns the current display value (may be fractional — the
 * caller formats it). Honours `prefers-reduced-motion` by jumping straight to
 * the target. Animates text content only — no layout/paint pressure.
 */
export function useCountUp(value: number, durationMs = 900): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = fromRef.current;
    const to = value;

    if (reduce || from === to || durationMs <= 0) {
      setDisplay(to);
      fromRef.current = to;
      return;
    }

    let raf = 0;
    let start = 0;
    const step = (t: number): void => {
      if (start === 0) start = t;
      const progress = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (to - from) * eased);
      if (progress < 1) {
        raf = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return display;
}
