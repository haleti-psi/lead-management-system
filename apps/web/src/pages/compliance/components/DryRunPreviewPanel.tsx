/**
 * FR-115 — DryRunPreviewPanel.
 * Displays the dry-run preview counts after a dry-run completes.
 */

import {
  DATA_CATEGORY_LABELS,
  RETENTION_ACTION_LABELS,
  type DryRunPreview,
} from '@/components/compliance/retention.types';

interface DryRunPreviewPanelProps {
  preview: DryRunPreview;
}

export function DryRunPreviewPanel({ preview }: DryRunPreviewPanelProps): JSX.Element {
  return (
    <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-4" role="region" aria-label="Dry-run preview">
      <h3 className="mb-3 text-sm font-semibold text-blue-900">Dry-Run Preview</h3>

      <div className="mb-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
        <div className="rounded-md bg-white p-3 shadow-sm">
          <div className="text-2xl font-bold text-blue-700">{preview.eligible_leads}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Eligible leads</div>
        </div>
        <div className="rounded-md bg-white p-3 shadow-sm">
          <div className="text-2xl font-bold text-red-600">{preview.blocked_by_legal_hold}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Blocked (legal hold)</div>
        </div>
        <div className="rounded-md bg-white p-3 shadow-sm">
          <div className="text-2xl font-bold text-amber-600">{preview.blocked_by_open_request}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Blocked (open request)</div>
        </div>
      </div>

      {preview.by_category.length > 0 && (
        <table className="w-full text-sm" aria-label="Breakdown by category">
          <thead>
            <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400">
              <th className="pb-1">Category</th>
              <th className="pb-1">Action</th>
              <th className="pb-1 text-right">Count</th>
            </tr>
          </thead>
          <tbody>
            {preview.by_category.map((item) => (
              <tr key={`${item.data_category}-${item.action}`} className="border-t border-gray-100">
                <td className="py-1 text-gray-700 dark:text-gray-300">
                  {DATA_CATEGORY_LABELS[item.data_category] ?? item.data_category}
                </td>
                <td className="py-1 text-gray-600 dark:text-gray-400">
                  {RETENTION_ACTION_LABELS[item.action] ?? item.action}
                </td>
                <td className="py-1 text-right font-medium text-gray-900 dark:text-gray-100">{item.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {preview.by_category.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">No leads eligible for retention processing.</p>
      )}
    </div>
  );
}
