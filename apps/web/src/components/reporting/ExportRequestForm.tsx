import type { ReactElement } from 'react';
import { useState } from 'react';

import type { MaskingLevel } from '@lms/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CreateExportRequest } from '@/lib/api/exports';
import { maskingOptionsForRole, scopeForRole } from '@/hooks/useExports';

const MASKING_LABELS: Readonly<Record<MaskingLevel, string>> = {
  full: 'Full masking (all PII hidden)',
  partial: 'Partial masking (format-preserving)',
  unmasked: 'Unmasked (requires approval)',
};

interface ExportRequestFormProps {
  reportCode: string;
  userRole: string;
  onSubmit: (req: CreateExportRequest) => void;
  isLoading: boolean;
}

/**
 * FR-122 — export request form. Masking_level options are role-filtered.
 * Validates required fields client-side before calling onSubmit.
 */
export function ExportRequestForm({
  reportCode,
  userRole,
  onSubmit,
  isLoading,
}: ExportRequestFormProps): ReactElement {
  const allowedMaskingLevels = maskingOptionsForRole(userRole);
  const defaultMasking = allowedMaskingLevels[0] ?? 'full';

  const [masking, setMasking] = useState<MaskingLevel>(defaultMasking);
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!purpose.trim()) {
      setError('Purpose is required.');
      return;
    }
    setError(null);
    onSubmit({
      report_code: reportCode,
      filters: {},
      scope: scopeForRole(userRole),
      masking_level: masking,
      purpose: purpose.trim(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="export-report-code">Report</Label>
        <Input id="export-report-code" value={reportCode} readOnly className="bg-muted" />
      </div>

      <div>
        <Label htmlFor="export-masking">Masking level</Label>
        <select
          id="export-masking"
          value={masking}
          onChange={(e) => setMasking(e.target.value as MaskingLevel)}
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {allowedMaskingLevels.map((level) => (
            <option key={level} value={level}>
              {MASKING_LABELS[level]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="export-purpose">Purpose</Label>
        <Input
          id="export-purpose"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="e.g. monthly_compliance_review"
          maxLength={255}
          aria-required="true"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Requesting…' : 'Request Export'}
        </Button>
      </div>
    </form>
  );
}
