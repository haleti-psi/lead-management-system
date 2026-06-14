import { useState, type ReactElement } from 'react';

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy_m: number;
}

export type GeoCaptureStatus = 'idle' | 'capturing' | 'captured' | 'denied' | 'error';

interface GeoCaptureProps {
  /** Currently captured geo point (null = not captured). */
  value: GeoPoint | null;
  /** Called when geo is captured or cleared. */
  onChange: (geo: GeoPoint | null) => void;
}

/**
 * FR-102 — Geolocation capture component for the mobile visit logger.
 *
 * Calls `navigator.geolocation.getCurrentPosition` on button press.
 * Graceful degradation: on PERMISSION_DENIED or unavailable API, shows a
 * StatusChip "Location unavailable" and omits geo from the form payload —
 * the backend accepts absence (geo is optional on visit tasks).
 *
 * WCAG 2.1 AA: aria-live region for status updates; aria-busy on capture.
 * GPS permission prompt text shown before triggering (BRD AC-4 consent-aligned).
 */
export function GeoCapture({ value, onChange }: GeoCaptureProps): ReactElement {
  const [status, setStatus] = useState<GeoCaptureStatus>(value ? 'captured' : 'idle');
  // Internal copy of the captured point for preview display.
  // Required because in controlled usage (value prop) the parent may not
  // have re-rendered yet when we need to show the preview immediately.
  const [capturedGeo, setCapturedGeo] = useState<GeoPoint | null>(value);

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
          accuracy_m: position.coords.accuracy,
        };
        setCapturedGeo(point);
        onChange(point);
        setStatus('captured');
      },
      () => {
        setStatus('denied');
        onChange(null);
      },
      { timeout: 10_000, maximumAge: 60_000, enableHighAccuracy: true },
    );
  }

  function clearLocation() {
    setCapturedGeo(null);
    onChange(null);
    setStatus('idle');
  }

  // Prefer the controlled value (parent-driven) for display; fall back to
  // internal capturedGeo so the preview appears immediately after capture
  // even before the parent re-renders with the new value.
  const displayGeo = value ?? capturedGeo;

  const statusMessage = (() => {
    if (status === 'denied' || status === 'error') return 'Location unavailable — logging without geo.';
    if (status === 'captured' && displayGeo) return `Captured: ${displayGeo.lat.toFixed(5)}, ${displayGeo.lng.toFixed(5)} (±${Math.round(displayGeo.accuracy_m)}m)`;
    return 'Optional — captures your current lat/lng for the visit record.';
  })();

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium" id="geo-capture-label">
        Visit location{' '}
        <span className="text-xs font-normal text-muted-foreground">(optional)</span>
      </p>

      {/* Consent-aligned prompt before triggering GPS (BRD AC-4) */}
      {status === 'idle' ? (
        <p className="text-xs text-muted-foreground">
          Location is used only to verify the visit and is stored with the lead record.
        </p>
      ) : null}

      {displayGeo ? (
        <div className="flex items-center gap-3">
          {/* MapPin preview (lat/lng display) */}
          <span
            data-testid="geo-preview"
            className="rounded-md bg-muted px-2 py-1 text-xs font-mono"
          >
            {displayGeo.lat.toFixed(5)}, {displayGeo.lng.toFixed(5)}
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
          aria-busy={status === 'capturing'}
          aria-describedby="geo-capture-status"
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          {status === 'capturing' ? 'Capturing…' : 'Capture Location'}
        </button>
      )}

      {/* StatusChip — WCAG aria-live for screen readers */}
      <p
        id="geo-capture-status"
        role="status"
        aria-live="polite"
        data-status={status}
        className={
          status === 'denied' || status === 'error'
            ? 'text-xs text-destructive'
            : 'text-xs text-muted-foreground'
        }
      >
        {statusMessage}
      </p>
    </div>
  );
}
