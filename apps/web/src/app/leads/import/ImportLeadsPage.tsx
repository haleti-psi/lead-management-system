import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/PageHeader';
import { useCan } from '@/lib/auth/capabilities';
import { isApiClientError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useLeadImport, type ImportJobResult } from '@/hooks/use-lead-import';

/**
 * FR-010 §UI — bulk lead import (capability `bulk_action`). Upload a CSV/Excel
 * file → `POST /leads/import` (202 accepted, async). The backend exposes no
 * import-job status GET, so this confirms the accepted job and points the user
 * to the lead list, where rows appear as they are processed.
 */
export function ImportLeadsPage(): ReactElement {
  const can = useCan();
  const importMut = useLeadImport();
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [job, setJob] = useState<ImportJobResult | null>(null);

  if (!can('bulk_action')) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Import leads</h1>
        <p className="text-sm text-muted-foreground" role="status">
          You don&apos;t have access to bulk import.
        </p>
      </div>
    );
  }

  const submit = (): void => {
    if (!file) return;
    importMut.mutate(file, {
      onSuccess: (result) => {
        setJob(result);
        setFile(null);
        toast.success('Import queued.');
      },
      onError: (error) =>
        toast.error(
          isApiClientError(error) && error.code === 'VALIDATION_ERROR'
            ? 'That file could not be imported. Check the format and try again.'
            : 'Import failed. Please try again.',
        ),
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Import leads" description="Bulk-create leads from a CSV or Excel file." />

      {job ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <span
              className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            >
              <CheckCircle2 className="h-6 w-6" />
            </span>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Import queued</h2>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                Your file was accepted and is processing in the background. New leads appear in the
                list as rows are validated and created.
              </p>
            </div>
            <dl className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Job ID <span className="font-mono text-foreground">{job.import_job_id}</span>
              </span>
              <span>
                Status{' '}
                <span className="font-medium capitalize text-foreground">
                  {String(job.status).replace(/_/g, ' ')}
                </span>
              </span>
              {job.total_rows != null ? (
                <span>
                  Rows <span className="font-medium tabular-nums text-foreground">{job.total_rows}</span>
                </span>
              ) : null}
            </dl>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" onClick={() => setJob(null)}>
                Import another file
              </Button>
              <Button asChild>
                <Link to="/leads">
                  View leads
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Upload file</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors',
                dragOver ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent/40',
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) setFile(dropped);
              }}
            >
              <span
                className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"
                aria-hidden
              >
                <Upload className="h-6 w-6" />
              </span>
              <span className="text-sm font-medium">
                {file ? file.name : 'Drop a CSV or Excel file here, or click to browse'}
              </span>
              <span className="text-xs text-muted-foreground">
                {file ? `${Math.max(1, Math.round(file.size / 1024))} KB` : '.csv, .xlsx or .xls'}
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="sr-only"
                aria-label="Choose a file to import"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Rows are validated server-side; invalid rows are reported without blocking the rest.
              </p>
              <div className="flex items-center gap-2 self-end">
                {file ? (
                  <Button variant="ghost" onClick={() => setFile(null)} disabled={importMut.isPending}>
                    Clear
                  </Button>
                ) : null}
                <Button onClick={submit} disabled={!file || importMut.isPending}>
                  {importMut.isPending ? 'Uploading…' : 'Start import'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
