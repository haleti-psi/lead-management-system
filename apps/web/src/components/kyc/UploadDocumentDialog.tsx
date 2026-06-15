import * as React from 'react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal';
import { isApiClientError } from '@/lib/api';
import { useUploadDocument, type UploadTarget } from '@/hooks/use-upload-document';
import type { ChecklistItem } from '@/types/documents';

/** Accept filter — the server allows PDF/JPEG/PNG/HEIC (LLD §Validation). */
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/heic,.pdf,.jpg,.jpeg,.png,.heic';
/** Client-side size hint; the server enforces the real cap (MAX_UPLOAD_MB → 413). */
const MAX_MB = 10;

/**
 * Upload affordance for one checklist item (LLD §UI — UploadDocumentButton). The
 * `doc_type` / `applicant_scope` come fixed from the row, so the form only takes
 * the file. `capture="environment"` lets a mobile browser offer the camera.
 */
export function UploadDocumentDialog({
  item,
  target,
}: {
  item: ChecklistItem;
  target: UploadTarget;
}): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const upload = useUploadDocument(target);

  function close(): void {
    setOpen(false);
    setFile(null);
    upload.reset();
  }

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`File is too large (max ${MAX_MB} MB).`);
      return;
    }
    upload.mutate(
      { file, doc_type: item.doc_type, applicant_scope: item.applicant_scope },
      {
        onSuccess: () => {
          toast.success(`${item.label} uploaded.`);
          close();
        },
        onError: (error) => {
          toast.error(uploadErrorMessage(error));
        },
      },
    );
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" aria-hidden />
        {item.document_id ? 'Re-upload' : 'Upload'}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={`Upload ${item.label}`}
        description="PDF, JPG, PNG or HEIC. The file is scanned for viruses after upload."
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="document-file" className="text-sm font-medium">
              File <span className="text-destructive" aria-hidden>{' *'}</span>
            </label>
            <input
              id="document-file"
              type="file"
              accept={ACCEPT}
              capture="environment"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent"
            />
            {file ? (
              <p className="text-xs text-muted-foreground">
                {file.name} · {Math.max(1, Math.round(file.size / 1024))} KB
              </p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={upload.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!file || upload.isPending}>
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Map a failed upload to user-safe copy (taxonomy codes never leak internals). */
function uploadErrorMessage(error: unknown): string {
  if (isApiClientError(error)) {
    switch (error.code) {
      case 'UNSUPPORTED_MEDIA':
        return 'Unsupported file type. Use PDF, JPG, PNG or HEIC.';
      case 'PAYLOAD_TOO_LARGE':
        return `File is too large (max ${MAX_MB} MB).`;
      case 'VALIDATION_ERROR':
        return 'The file could not be accepted. Please check and try again.';
      case 'RATE_LIMITED':
        return 'Too many uploads. Please wait a moment and try again.';
      case 'FORBIDDEN':
        return "You don't have access to upload for this lead.";
      case 'UPSTREAM_UNAVAILABLE':
        return 'Document storage is temporarily unavailable. Please try again.';
      default:
        return 'Upload failed. Please try again.';
    }
  }
  return error instanceof Error ? error.message : 'Upload failed. Please try again.';
}
