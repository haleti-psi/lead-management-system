import * as React from 'react';
import { useParams } from 'react-router-dom';
import { ApplicantScope, DocType } from '@lms/shared';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { isApiClientError } from '@/lib/api';
import { useUploadDocument } from '@/hooks/use-upload-document';

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/heic,.pdf,.jpg,.jpeg,.png,.heic';
const MAX_MB = 10;

/** Title-case an enum value (`co_applicant` → `Co Applicant`) for option labels. */
function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/**
 * Customer self-service upload (LLD §UI — CustomerUploadPage) at `/c/:token/upload`.
 * Public (no JWT); the opaque token authorises the upload server-side
 * (`CustomerLinkGuard`/FR-060 seam). There is no checklist GET on the public path,
 * so the customer picks the document type and applicant, then uploads — the same
 * two-phase protocol as staff, scoped to the token's lead.
 */
export function CustomerUploadPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const [docType, setDocType] = React.useState<DocType>(DocType.PAN);
  const [scope, setScope] = React.useState<ApplicantScope>(ApplicantScope.APPLICANT);
  const [file, setFile] = React.useState<File | null>(null);
  const [done, setDone] = React.useState(false);

  const upload = useUploadDocument({ kind: 'customer', token: token ?? '' });

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!file || !token) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`File is too large (max ${MAX_MB} MB).`);
      return;
    }
    upload.mutate(
      { file, doc_type: docType, applicant_scope: scope },
      {
        onSuccess: () => {
          setDone(true);
          setFile(null);
        },
        onError: (error) => toast.error(uploadErrorMessage(error)),
      },
    );
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-4 p-4">
      <div className="flex items-center justify-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground" aria-hidden>
          L
        </div>
        <span className="text-base font-semibold tracking-tight">LMS</span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Upload a document</CardTitle>
          <CardDescription>
            Upload a clear photo or PDF. Accepted: PDF, JPG, PNG, HEIC (max {MAX_MB} MB).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center" role="status">
              <CheckCircle2 className="h-10 w-10 text-green-600" aria-hidden />
              <p className="font-medium">Document received</p>
              <p className="text-sm text-muted-foreground">
                Thank you. You can upload another document if needed.
              </p>
              <Button variant="outline" className="mt-2" onClick={() => setDone(false)}>
                Upload another
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="doc-type">Document type</Label>
                <select
                  id="doc-type"
                  className={SELECT_CLASS}
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as DocType)}
                >
                  {Object.values(DocType).map((value) => (
                    <option key={value} value={value}>
                      {humanize(value)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="applicant-scope">Applicant</Label>
                <select
                  id="applicant-scope"
                  className={SELECT_CLASS}
                  value={scope}
                  onChange={(e) => setScope(e.target.value as ApplicantScope)}
                >
                  {Object.values(ApplicantScope).map((value) => (
                    <option key={value} value={value}>
                      {humanize(value)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="customer-file">
                  File <span className="text-destructive" aria-hidden>{' *'}</span>
                </Label>
                <input
                  id="customer-file"
                  type="file"
                  accept={ACCEPT}
                  capture="environment"
                  required
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className={cn(
                    'block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input',
                    'file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent',
                  )}
                />
                {file ? (
                  <p className="text-xs text-muted-foreground">
                    {file.name} · {Math.max(1, Math.round(file.size / 1024))} KB
                  </p>
                ) : null}
              </div>

              <Button type="submit" className="w-full" disabled={!file || upload.isPending}>
                {upload.isPending ? 'Uploading…' : 'Upload'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function uploadErrorMessage(error: unknown): string {
  if (isApiClientError(error)) {
    switch (error.code) {
      case 'NOT_FOUND':
        return 'This upload link is no longer valid. Please request a new link.';
      case 'UNSUPPORTED_MEDIA':
        return 'Unsupported file type. Use PDF, JPG, PNG or HEIC.';
      case 'PAYLOAD_TOO_LARGE':
        return `File is too large (max ${MAX_MB} MB).`;
      case 'VALIDATION_ERROR':
        return 'The file could not be accepted. Please check and try again.';
      case 'RATE_LIMITED':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'UPSTREAM_UNAVAILABLE':
        return 'Document storage is temporarily unavailable. Please try again.';
      default:
        return 'Upload failed. Please try again.';
    }
  }
  return error instanceof Error ? error.message : 'Upload failed. Please try again.';
}
