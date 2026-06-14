import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';

import type { TemplateDto } from './use-templates';

interface TemplateBodyDrawerProps {
  template: TemplateDto;
  onClose: () => void;
}

/**
 * FR-101 — Read-only drawer showing a template's body content.
 * No edit capability here; activation is via the FR-131 maker-checker path.
 */
export function TemplateBodyDrawer({ template, onClose }: TemplateBodyDrawerProps): ReactElement {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Template body — ${template.code} v${String(template.version)}`}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl"
    >
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h2 className="text-base font-semibold">{template.code}</h2>
          <p className="text-xs text-gray-500">
            v{template.version} · {template.channel} · {template.language} · {template.category}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close drawer">
          ✕
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Body</p>
        <pre className="whitespace-pre-wrap rounded bg-gray-50 p-4 text-sm">
          {template.body}
        </pre>

        {template.status === 'draft' ? (
          <p className="mt-4 rounded bg-yellow-50 px-3 py-2 text-xs text-yellow-700">
            Pending activation — this template is in draft status and must be approved via the maker-checker flow before it can be used for dispatch.
          </p>
        ) : null}
      </div>
    </div>
  );
}
