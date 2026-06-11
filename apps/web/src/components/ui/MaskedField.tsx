import { useState, type ReactElement } from 'react';
import { Eye, Loader2 } from 'lucide-react';

/** PII field kinds the masked field can render (FR-002 §Masking Rules / UI). */
export type MaskedFieldType = 'pan' | 'mobile' | 'aadhaar';

const FIELD_LABEL: Readonly<Record<MaskedFieldType, string>> = {
  pan: 'PAN',
  mobile: 'mobile',
  aadhaar: 'Aadhaar',
};

export interface MaskedFieldProps {
  /** The already server-masked value (FR-002 masks on serialisation). */
  maskedValue: string;
  fieldType: MaskedFieldType;
  /**
   * Whether the caller may reveal the raw value — derived from the effective
   * scope (an active break-glass grant). When false, only the masked value shows.
   */
  canUnmask?: boolean;
  /** The lead the value belongs to (passed to the unmask call). */
  leadId?: string;
  /**
   * Host-supplied unmask action. FR-002 renders the affordance; the raw-value
   * fetch is the separately-audited unmask path owned by FR-003
   * (`POST /audit/unmask`). The host wires this to the api client; when omitted,
   * no Reveal button is shown even if `canUnmask` is true.
   */
  onReveal?: (args: { leadId?: string; fieldType: MaskedFieldType }) => Promise<string>;
}

/**
 * FR-002 shared component — renders a masked PAN/mobile/Aadhaar value and, when
 * the caller is entitled (active break-glass) AND a host `onReveal` handler is
 * provided, a keyboard-accessible "Reveal" button that swaps in the raw value
 * inline. While the unmask is in flight a spinner shows; on failure an inline,
 * non-blocking error message is rendered. Self-contained (React + lucide only):
 * the shadcn primitive styling and the api-client/toast wiring are applied by the
 * web foundation wave around this component, not inside it.
 *
 * Accessibility (WCAG 2.1 AA): the value carries `aria-label="masked <field>"`;
 * the Reveal control is a real <button> with `aria-label="Reveal <FIELD>"` and a
 * visible focus ring.
 */
export function MaskedField({
  maskedValue,
  fieldType,
  canUnmask = false,
  leadId,
  onReveal,
}: MaskedFieldProps): ReactElement {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = FIELD_LABEL[fieldType];
  const showReveal = canUnmask && onReveal != null && revealed == null;

  async function handleReveal(): Promise<void> {
    if (onReveal == null) return;
    setLoading(true);
    setError(null);
    try {
      const raw = await onReveal({ leadId, fieldType });
      setRevealed(raw);
    } catch {
      // Non-blocking, generic message (no leak of the underlying cause).
      setError("Couldn't reveal this value. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="masked-field">
      <span aria-label={`masked ${label}`}>{revealed ?? maskedValue}</span>

      {showReveal ? (
        <button
          type="button"
          aria-label={`Reveal ${label.toUpperCase()}`}
          disabled={loading}
          onClick={() => {
            void handleReveal();
          }}
          className="masked-field__reveal"
        >
          {loading ? (
            <Loader2 aria-hidden className="masked-field__spinner" role="status" />
          ) : (
            <Eye aria-hidden />
          )}
        </button>
      ) : null}

      {loading ? (
        <span role="status" className="masked-field__loading">
          Revealing…
        </span>
      ) : null}

      {error != null ? (
        <span role="alert" className="masked-field__error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
