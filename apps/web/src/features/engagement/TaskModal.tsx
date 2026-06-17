import { useState, type ReactElement, type FormEvent } from 'react';

import { isApiClientError } from '@/lib/api';

import type { CreateTaskInput, TaskDisposition, TaskDto, TaskPriority, TaskType, UpdateTaskInput, GeoPoint } from './use-tasks';
import { useCreateTask, useUpdateTask } from './use-tasks';
import { VisitLoggerSection } from './VisitLoggerSection';

const TASK_TYPES: Array<{ label: string; value: TaskType }> = [
  { label: 'Call', value: 'call' },
  { label: 'Visit', value: 'visit' },
  { label: 'Doc Request', value: 'doc_request' },
  { label: 'KYC Appointment', value: 'kyc_appt' },
  { label: 'Dealer Follow-up', value: 'dealer_followup' },
  { label: 'Callback', value: 'callback' },
  { label: 'Approval', value: 'approval' },
  { label: 'Handoff Retry', value: 'handoff_retry' },
  { label: 'Nurture', value: 'nurture' },
];

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

const PRIORITY_OPTIONS: Array<{ label: string; value: TaskPriority }> = [
  { label: 'Low', value: 'low' },
  { label: 'Normal', value: 'normal' },
  { label: 'High', value: 'high' },
];

interface CreateTaskModalProps {
  mode: 'create';
  defaultLeadId?: string;
  callerId: string;
  onClose: () => void;
  onSuccess: (task: TaskDto) => void;
}

interface UpdateTaskModalProps {
  mode: 'update';
  task: TaskDto;
  canReassign: boolean;
  onClose: () => void;
  onSuccess: (task: TaskDto) => void;
}

type TaskModalProps = CreateTaskModalProps | UpdateTaskModalProps;

/**
 * FR-100 — Create/edit modal for tasks.
 * Rendered as a native <dialog> (shadcn Dialog not yet in the web foundation).
 * WCAG 2.1 AA: focus-trap via autofocus on close button; aria-modal; Escape key.
 */
export function TaskModal(props: TaskModalProps): ReactElement {
  const isCreate = props.mode === 'create';

  // Form state
  const [leadId, setLeadId] = useState(isCreate ? (props.defaultLeadId ?? '') : props.task.lead_id);
  const [type, setType] = useState<TaskType>(isCreate ? 'call' : props.task.type);
  const [ownerId, setOwnerId] = useState(isCreate ? props.callerId : props.task.owner_id);
  const [dueAt, setDueAt] = useState(isCreate ? '' : props.task.due_at.slice(0, 16));
  const [priority, setPriority] = useState<TaskPriority>(isCreate ? 'normal' : props.task.priority);
  const [resultNote, setResultNote] = useState(isCreate ? '' : (props.task.result_note ?? ''));
  const [disposition, setDisposition] = useState<TaskDisposition | ''>(
    isCreate ? '' : (props.task.disposition ?? ''),
  );
  const [nextActionAt, setNextActionAt] = useState(
    isCreate ? '' : (props.task.next_action_at?.slice(0, 16) ?? ''),
  );
  const [geo, setGeo] = useState<GeoPoint | null>(isCreate ? null : props.task.geo);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createMutation = useCreateTask();
  const updateMutation = useUpdateTask(!isCreate ? props.task.task_id : '');

  const isPending = isCreate ? createMutation.isPending : updateMutation.isPending;

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (isCreate && !leadId) newErrors.lead_id = 'Lead is required.';
    if (isCreate && !ownerId) newErrors.owner_id = 'Assignee is required.';
    if (!dueAt) newErrors.due_at = 'Due date and time is required.';
    else if (isCreate && new Date(dueAt) <= new Date()) {
      newErrors.due_at = 'Due date must be in the future.';
    }
    if (!isCreate && !disposition) {
      // Only require disposition when completing
    }
    if (resultNote.length > 1000) newErrors.result_note = 'Result note must not exceed 1000 characters.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    try {
      let result: TaskDto;
      if (isCreate) {
        const input: CreateTaskInput = {
          lead_id: leadId,
          type,
          owner_id: ownerId,
          due_at: new Date(dueAt).toISOString(),
          priority,
          result_note: resultNote || null,
          next_action_at: nextActionAt ? new Date(nextActionAt).toISOString() : null,
          geo: geo ?? null,
        };
        result = await createMutation.mutateAsync(input);
      } else {
        const input: UpdateTaskInput = {
          due_at: new Date(dueAt).toISOString(),
          priority,
          result_note: resultNote || null,
          disposition: disposition !== '' ? disposition : undefined,
          next_action_at: nextActionAt ? new Date(nextActionAt).toISOString() : null,
          geo: geo ?? null,
          ...(!isCreate && (props as UpdateTaskModalProps).canReassign && ownerId !== props.task.owner_id
            ? { owner_id: ownerId }
            : {}),
        };
        result = await updateMutation.mutateAsync(input);
      }
      props.onSuccess(result);
      props.onClose();
    } catch (err) {
      if (isApiClientError(err) && err.fields) {
        const fieldErrors: Record<string, string> = {};
        for (const f of err.fields) {
          fieldErrors[f.field] = f.issue ?? `${f.field} is invalid.`;
        }
        setErrors(fieldErrors);
      } else {
        setSubmitError('An error occurred. Please try again.');
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (e.key === 'Escape') {
      props.onClose();
    }
  }

  return (
    <dialog
      open
      aria-modal="true"
      aria-labelledby="task-modal-title"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg bg-background p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="task-modal-title" className="text-lg font-semibold">
            {isCreate ? 'Create Task' : 'Update Task'}
          </h2>
          <button
            type="button"
            autoFocus
            onClick={props.onClose}
            aria-label="Close"
            className="rounded p-1 hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
          >
            ✕
          </button>
        </div>

        {submitError ? (
          <p role="alert" className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {submitError}
          </p>
        ) : null}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Lead ID (create only) */}
          {isCreate ? (
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="task-lead-id">
                Lead ID <span aria-hidden>*</span>
              </label>
              <input
                id="task-lead-id"
                type="text"
                required
                value={leadId}
                onChange={(e) => setLeadId(e.target.value)}
                placeholder="Lead UUID"
                aria-invalid={errors.lead_id != null}
                aria-describedby={errors.lead_id ? 'task-lead-id-error' : undefined}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {errors.lead_id ? (
                <p id="task-lead-id-error" role="alert" className="mt-1 text-xs text-destructive">
                  {errors.lead_id}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Type */}
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="task-type">
              Type <span aria-hidden>*</span>
            </label>
            <select
              id="task-type"
              value={type}
              onChange={(e) => setType(e.target.value as TaskType)}
              disabled={!isCreate}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {TASK_TYPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Owner ID */}
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="task-owner">
              Assignee (user ID){isCreate ? <span aria-hidden> *</span> : null}
            </label>
            <input
              id="task-owner"
              type="text"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              placeholder="User UUID"
              disabled={!isCreate && !(props as UpdateTaskModalProps).canReassign}
              aria-invalid={errors.owner_id != null}
              aria-describedby={errors.owner_id ? 'task-owner-error' : undefined}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            />
            {errors.owner_id ? (
              <p id="task-owner-error" role="alert" className="mt-1 text-xs text-destructive">
                {errors.owner_id}
              </p>
            ) : null}
          </div>

          {/* Due at */}
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="task-due-at">
              Due date & time <span aria-hidden>*</span>
            </label>
            <input
              id="task-due-at"
              type="datetime-local"
              required
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              aria-invalid={errors.due_at != null}
              aria-describedby={errors.due_at ? 'task-due-at-error' : undefined}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {errors.due_at ? (
              <p id="task-due-at-error" role="alert" className="mt-1 text-xs text-destructive">
                {errors.due_at}
              </p>
            ) : null}
          </div>

          {/* Priority */}
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="task-priority">
              Priority
            </label>
            <select
              id="task-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Disposition (update only — when completing) */}
          {!isCreate ? (
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="task-disposition">
                Disposition{' '}
                <span className="text-xs font-normal text-muted-foreground">(required when completing)</span>
              </label>
              <select
                id="task-disposition"
                value={disposition}
                onChange={(e) => setDisposition(e.target.value as TaskDisposition | '')}
                aria-invalid={errors.disposition != null}
                aria-describedby={errors.disposition ? 'task-disposition-error' : undefined}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">— select —</option>
                {DISPOSITION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {errors.disposition ? (
                <p id="task-disposition-error" role="alert" className="mt-1 text-xs text-destructive">
                  {errors.disposition}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Result note */}
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="task-result-note">
              Result note{' '}
              <span className="text-xs font-normal text-muted-foreground">(max 1000 chars)</span>
            </label>
            <textarea
              id="task-result-note"
              value={resultNote}
              onChange={(e) => setResultNote(e.target.value)}
              maxLength={1000}
              rows={3}
              aria-invalid={errors.result_note != null}
              aria-describedby={errors.result_note ? 'task-result-note-error' : undefined}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {errors.result_note ? (
              <p id="task-result-note-error" role="alert" className="mt-1 text-xs text-destructive">
                {errors.result_note}
              </p>
            ) : null}
          </div>

          {/* Next action at */}
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="task-next-action-at">
              Next action at <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              id="task-next-action-at"
              type="datetime-local"
              value={nextActionAt}
              onChange={(e) => setNextActionAt(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Geo capture (visit only) */}
          {type === 'visit' ? (
            <VisitLoggerSection geo={geo} onCapture={setGeo} />
          ) : null}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-md border border-input px-4 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isPending ? 'Saving…' : isCreate ? 'Create Task' : 'Update Task'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
