import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Shared confirmation dialog (ui.md §States — destructive/important actions
 * always confirm). A lightweight token-driven overlay: scrim + centred card,
 * `role="alertdialog"`, Escape-to-cancel via the backdrop click, and a primary
 * (or destructive) confirm button. Render conditionally with `open`.
 */
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (e.g. reject / delete). */
  destructive?: boolean;
  /** Disable both buttons while the underlying action is in flight. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element | null {
  if (!open) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
    >
      <div className="fixed inset-0 bg-black/50" aria-hidden onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm animate-scale-in rounded-lg border bg-popover p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description ? <div className="mt-2 text-sm text-muted-foreground">{description}</div> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            size="sm"
            onClick={onConfirm}
            disabled={pending}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
