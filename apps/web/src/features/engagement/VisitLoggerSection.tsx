import { useState, type ReactElement } from 'react';

import type { GeoPoint } from './use-tasks';

interface VisitLoggerSectionProps {
  geo: GeoPoint | null;
  onCapture: (geo: GeoPoint | null) => void;
}

/**
 * FR-100 — Geo capture sub-form shown inside TaskModal when `type === 'visit'`.
 * Attempts `navigator.geolocation`; degrades gracefully when denied (shows
 * "Location access denied" message without breaking the form).
 * WCAG 2.1 AA: feedback via aria-live region.
 */
export function VisitLoggerSection({ geo, onCapture }: VisitLoggerSectionProps): ReactElement {
  const [status, setStatus] = useState<'idle' | 'capturing' | 'captured' | 'denied' | 'error'>('idle');

  function captureLocation() {
    if (!navigator.geolocation) {
      setStatus('denied');
      return;
    }

    setStatus('capturing');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point: GeoPoint = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        onCapture(point);
        setStatus('captured');
      },
      () => {
        setStatus('denied');
        onCapture(null);
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function clearLocation() {
    onCapture(null);
    setStatus('idle');
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Visit location</p>
      {geo ? (
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-muted px-2 py-1 text-xs font-mono">
            {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)}
          </span>
          <button
            type="button"
            onClick={clearLocation}
            className="text-xs text-destructive underline-offset-2 hover:underline"
          >
            Clear
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={captureLocation}
          disabled={status === 'capturing'}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          aria-busy={status === 'capturing'}
        >
          {status === 'capturing' ? 'Capturing…' : 'Capture location'}
        </button>
      )}
      <p
        aria-live="polite"
        className={
          status === 'denied' || status === 'error'
            ? 'text-xs text-destructive'
            : 'text-xs text-muted-foreground'
        }
      >
        {status === 'denied' && 'Location access denied — geo not recorded.'}
        {status === 'error' && 'Could not capture location.'}
        {status === 'captured' && 'Location captured.'}
        {(status === 'idle' || status === 'capturing') && 'Optional — captures your current lat/lng.'}
      </p>
    </div>
  );
}
