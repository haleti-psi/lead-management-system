import { useState, type FormEvent, type ReactElement } from 'react';

import { isApiClientError } from '@/lib/api';

import type { GeoPoint as TaskGeoPoint, TaskDisposition } from '@/features/engagement/use-tasks';
import { useUpdateTask } from '@/features/engagement/use-tasks';
import { GeoCapture, type GeoPoint } from './GeoCapture';

const DISPOSITION_OPTIONS: Array<{ label: string; value: TaskDisposition }> = [
  { label: 'Connected', value: 'connected' },
  { label: 'No Answer', value: 'no_answer' },
  { label: 'Wrong Number', value: 'wrong_number' },
  { label: 'Not Interested', value: 'not_interested' },
  { label: 'Visited', value: 'visited' },
  { label: 'Rescheduled', value: 'rescheduled' },
  { label: 'Callback Requested', value: 'callback_requested' },
  { label: 'Docs Promised', value: 'docs_promised' },
];

/** Dispositions that require `next_action_at`. */
const REQUIRES_NEXT_ACTION = new Set<TaskDisposition>(['rescheduled', 'callback_requested']);

interface DispositionFormProps {
  taskId: string;
  /** Task type — controls whether GeoCapture is shown. */
  taskType: string;
  onSuccess: (result: { task_id: string; disposition: string }) => void;
  onCancel?: () => void;
}

/**
 * FR-102 — Disposition logging form used in:
 *   - Desktop: embedded in the TaskPanel Lead 360 view (wrapped in a Sheet/Drawer).
 *   - Mobile: standalone on the VisitLogPage.
 *
 * Uses `useUpdateTask` (PATCH /tasks/:id) to submit the disposition.
 * Inline field errors from API VALIDATION_ERROR.fields are mapped below each control.
 * Success: shows a Toast ("Outcome logged") and calls `onSuccess`.
 *
 * GeoCapture is shown for 'call' and 'visit' task types (mobile: always; desktop:
 * disabled as per LLD §UI Component Tree).
 */
export function DispositionForm({
  taskId,
  taskType,
  onSuccess,
  onCancel,
}: DispositionFormProps): ReactElement {
  const [disposition, setDisposition] = useState<TaskDisposition | ''>('');
  const [resultNote, setResultNote] = useState('');
  const [nextActionAt, setNextActionAt] = useState('');
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const updateTask = useUpdateTask(taskId);
  const showGeo = taskType === 'call' || taskType === 'visit';
  const showNextAction = disposition !== '' && REQUIRES_NEXT_ACTION.has(disposition as TaskDisposition);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (disposition === '') {
      errors.disposition = 'Please select a disposition.';
    }
    if (showNextAction && !nextActionAt) {
      errors.next_action_at = 'next_action_at is required for rescheduled or callback_requested dispositions.';
    }
    if (resultNote.length > 1000) {
      errors.result_note = 'result_note must not exceed 1000 characters.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    try {
      const geoPayload: (TaskGeoPoint & { accuracy_m: number }) | null =
        geo ? { lat: geo.lat, lng: geo.lng, accuracy_m: geo.accuracy_m } : null;

      const result = await updateTask.mutateAsync({
        disposition: disposition as TaskDisposition,
        result_note: resultNote || null,
        next_action_at: nextActionAt ? new Date(nextActionAt).toISOString() : null,
        geo: geoPayload,
      });

      setShowSuccess(true);
      onSuccess({ task_id: result.task_id, disposition: result.disposition ?? '' });
    } catch (err) {
      if (isApiClientError(err) && err.fields) {
        const errors: Record<string, string> = {};
        for (const f of err.fields) {
          errors[f.field] = f.issue ?? `${f.field} is invalid.`;
        }
        setFieldErrors(errors);
      } else {
        setSubmitError('An error occurred. Please try again.');
      }
    }
  }

  // Success toast
  if (showSuccess) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800"
      >
        Outcome logged.{' '}
        {onCancel ? (
          <button type="button" onClick={onCancel} className="underline underline-offset-2">
            Close
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {submitError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {submitError}
        </p>
      ) : null}

      {/* Disposition select */}
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="disposition-select">
          Outcome <span aria-hidden>*</span>
        </label>
        <select
          id="disposition-select"
          value={disposition}
          onChange={(e) => {
            setDisposition(e.target.value as TaskDisposition | '');
            setFieldErrors((prev) => ({ ...prev, disposition: '' }));
          }}
          aria-invalid={fieldErrors.disposition != null && fieldErrors.disposition !== ''}
          aria-describedby={fieldErrors.disposition ? 'disposition-error' : undefined}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">— select outcome —</option>
          {DISPOSITION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {fieldErrors.disposition ? (
          <p id="disposition-error" role="alert" className="mt-1 text-xs text-destructive">
            {fieldErrors.disposition}
          </p>
        ) : null}
      </div>

      {/* Result note */}
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="result-note">
          Notes{' '}
          <span className="text-xs font-normal text-muted-foreground">(max 1000 chars)</span>
        </label>
        <textarea
          id="result-note"
          value={resultNote}
          onChange={(e) => setResultNote(e.target.value)}
          maxLength={1000}
          rows={3}
          aria-invalid={fieldErrors.result_note != null && fieldErrors.result_note !== ''}
          aria-describedby={fieldErrors.result_note ? 'result-note-error' : undefined}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {fieldErrors.result_note ? (
          <p id="result-note-error" role="alert" className="mt-1 text-xs text-destructive">
            {fieldErrors.result_note}
          </p>
        ) : null}
      </div>

      {/* Next action at — conditional on disposition requiring it */}
      {showNextAction ? (
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="next-action-at">
            Schedule follow-up <span aria-hidden>*</span>
          </label>
          <input
            id="next-action-at"
            type="datetime-local"
            value={nextActionAt}
            onChange={(e) => setNextActionAt(e.target.value)}
            aria-invalid={fieldErrors.next_action_at != null && fieldErrors.next_action_at !== ''}
            aria-describedby={fieldErrors.next_action_at ? 'next-action-at-error' : undefined}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {fieldErrors.next_action_at ? (
            <p id="next-action-at-error" role="alert" className="mt-1 text-xs text-destructive">
              {fieldErrors.next_action_at}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* GeoCapture — shown for call/visit tasks */}
      {showGeo ? (
        <GeoCapture value={geo} onChange={setGeo} />
      ) : null}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-input px-4 py-2 text-sm hover:bg-muted"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          disabled={disposition === '' || updateTask.isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {updateTask.isPending ? 'Logging…' : 'Log Outcome'}
        </button>
      </div>
    </form>
  );
}
