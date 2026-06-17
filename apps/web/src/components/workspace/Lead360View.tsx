import { useState, type ReactElement, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MaskedField } from '@/components/ui/MaskedField';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { PageHeader } from '@/components/layout/PageHeader';
import { isApiClientError } from '@/lib/api';
import { SectionTabs } from './SectionTabs';
import { StatusChip } from './StatusChip';
import { useLead360 } from './use-lead360';
import type { Lead360Response } from './lead360.types';

/**
 * FR-051 — the Lead-360 view (LLD §UI Component Tree): summary card, the
 * section tabs (Overview / Documents / KYC / Tasks / Consent / LOS / Audit)
 * and the collapsible notes timeline. Data comes from `useLead360`
 * (`GET /api/v1/leads/:id` via the foundation apiClient); every PII value in
 * the response is already server-masked (FR-002) and PAN/mobile render through
 * the shared `MaskedField`. States: `LoadingSkeleton` while pending,
 * `ErrorState` on failure (generic copy — never an internal cause), and
 * per-section `EmptyState`s for empty data (TC-051-11 sections).
 */
export function Lead360View({ leadId }: { leadId: string }): ReactElement {
  const { data, isPending, isError, error, refetch } = useLead360(leadId);

  if (isPending) {
    return <LoadingSkeleton rows={8} />;
  }

  if (isError || !data) {
    const message =
      isApiClientError(error) && error.code === 'NOT_FOUND'
        ? "We couldn't find that item."
        : 'Please try again.';
    return (
      <ErrorState
        title="Couldn't load this lead"
        message={message}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[{ label: 'Leads', to: '/leads' }, { label: data.leadCode }]}
        title={data.leadCode}
      />
      <LeadSummaryCard lead={data} />
      <SectionTabs
        ariaLabel="Lead sections"
        tabs={[
          { id: 'overview', label: 'Overview', content: <OverviewTab lead={data} /> },
          { id: 'documents', label: 'Documents', content: <DocumentSummaryCard summary={data.documentSummary} /> },
          { id: 'kyc', label: 'KYC', content: <KycSummaryCard summary={data.kycSummary} /> },
          { id: 'tasks', label: 'Tasks', content: <OpenTasksSummary count={data.openTaskCount} /> },
          { id: 'consent', label: 'Consent', content: <ConsentCoverageList items={data.consentSummary} /> },
          { id: 'los', label: 'LOS', content: <LosTab lead={data} /> },
          { id: 'audit', label: 'Audit', content: <AuditTab /> },
        ]}
      />
      <NotesTimeline notes={data.notes} />
    </div>
  );
}

/** Header card: identity (masked), key chips, owner/branch/team placement. */
export function LeadSummaryCard({ lead }: { lead: Lead360Response }): ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{lead.identity.name}</CardTitle>
          {lead.isHot ? <StatusChip status="hot" tone="negative" label="Priority" /> : null}
          <StatusChip status={lead.stage} label="Stage" />
          <StatusChip status={lead.kycStatus} label="KYC status" />
          <StatusChip status={lead.consentStatus} label="Consent status" />
          <StatusChip status={lead.duplicateStatus} label="Duplicate status" />
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Mobile">
          <MaskedField maskedValue={lead.identity.mobile} fieldType="mobile" leadId={lead.leadId} />
        </Field>
        <Field label="PAN">
          {lead.identity.panMasked ? (
            <MaskedField maskedValue={lead.identity.panMasked} fieldType="pan" leadId={lead.leadId} />
          ) : (
            <Muted>Not provided</Muted>
          )}
        </Field>
        <Field label="Email">{lead.identity.email ?? <Muted>Not provided</Muted>}</Field>
        <Field label="Owner">{lead.owner?.displayName ?? <Muted>Unassigned</Muted>}</Field>
        <Field label="Branch">{lead.branch?.name ?? <Muted>—</Muted>}</Field>
        <Field label="Team">{lead.team?.name ?? <Muted>—</Muted>}</Field>
        <Field label="Requested amount">
          {lead.requestedAmount ?? <Muted>Not specified</Muted>}
        </Field>
        <Field label="Product">{lead.productDetail?.productCode ?? <Muted>—</Muted>}</Field>
        <Field label="Created">{formatDateTime(lead.createdAt)}</Field>
      </CardContent>
    </Card>
  );
}

/** Overview tab: product/source, stage tracker, score, SLA, duplicates. */
function OverviewTab({ lead }: { lead: Lead360Response }): ReactElement {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <ProductSourceCard lead={lead} />
      <ScoreCard score={lead.score} scoreReasons={lead.scoreReasons} />
      <SLACard lead={lead} />
      <DuplicateMatchesList matches={lead.duplicateMatches} />
      <div className="md:col-span-2">
        <StageTrackerCard history={lead.stageHistory} />
      </div>
    </div>
  );
}

function ProductSourceCard({ lead }: { lead: Lead360Response }): ReactElement {
  const { sourceAttribution: sa, productDetail, partner } = lead;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Product &amp; source</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Field label="Product">{productDetail?.productCode ?? <Muted>—</Muted>}</Field>
        <Field label="Validation">
          {productDetail ? <StatusChip status={productDetail.validationStatus} /> : <Muted>—</Muted>}
        </Field>
        <Field label="Source">{sa.source}</Field>
        <Field label="Sub-source">{sa.subSource ?? <Muted>—</Muted>}</Field>
        <Field label="Campaign">{sa.campaignCode ?? <Muted>—</Muted>}</Field>
        <Field label="Partner">
          {partner ? (
            <span className="inline-flex items-center gap-2">
              {partner.legalName} ({partner.partnerCode})
              <StatusChip status={partner.status} label="Partner status" />
            </span>
          ) : (
            <Muted>Direct</Muted>
          )}
        </Field>
      </CardContent>
    </Card>
  );
}

/** Stage tracker (LLD: stageHistory list, newest first; empty → EmptyState). */
function StageTrackerCard({ history }: { history: Lead360Response['stageHistory'] }): ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Stage history</CardTitle>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <EmptyState title="No stage changes yet" message="Stage transitions will appear here." />
        ) : (
          <ol className="space-y-3 text-sm">
            {history.map((entry) => (
              <li key={entry.stageHistoryId} className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">{formatDateTime(entry.occurredAt)}</span>
                {entry.fromStage ? <StatusChip status={entry.fromStage} /> : null}
                <span aria-hidden>→</span>
                <StatusChip status={entry.toStage} />
                {entry.reason ? <span className="text-muted-foreground">({entry.reason})</span> : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function ScoreCard({
  score,
  scoreReasons,
}: {
  score: number | null;
  scoreReasons: Record<string, unknown> | null;
}): ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Score</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {score === null ? (
          <EmptyState title="Not scored yet" />
        ) : (
          <>
            <p className="text-2xl font-semibold">{score}</p>
            {scoreReasons ? (
              <ul className="mt-2 space-y-1">
                {Object.entries(scoreReasons).map(([factor, value]) => (
                  <li key={factor} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{factor.replaceAll('_', ' ')}</span>
                    <span>{String(value)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SLACard({ lead }: { lead: Lead360Response }): ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">SLA</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Field label="First contact due">
          {lead.slaFirstContactDueAt ? formatDateTime(lead.slaFirstContactDueAt) : <Muted>No SLA set</Muted>}
        </Field>
        <Field label="Next nurture">
          {lead.nurtureNextAt ? formatDateTime(lead.nurtureNextAt) : <Muted>—</Muted>}
        </Field>
        <Field label="Reopened">{String(lead.reopenedCount)}</Field>
      </CardContent>
    </Card>
  );
}

function DuplicateMatchesList({
  matches,
}: {
  matches: Lead360Response['duplicateMatches'];
}): ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Open duplicate matches</CardTitle>
      </CardHeader>
      <CardContent>
        {matches.length === 0 ? (
          <EmptyState title="No open duplicates" />
        ) : (
          <ul className="space-y-2 text-sm">
            {matches.map((match) => (
              <li key={match.duplicateMatchId} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{match.matchedLeadCode}</span>
                <StatusChip status={match.confidence} label="Confidence" />
                <StatusChip status={match.action} label="Action" />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Documents tab (detail screens land with FR-070). */
function DocumentSummaryCard({
  summary,
}: {
  summary: Lead360Response['documentSummary'];
}): ReactElement {
  return (
    <Card data-testid="document-summary-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Documents</CardTitle>
      </CardHeader>
      <CardContent>
        {summary.total === 0 ? (
          <EmptyState title="No documents" message="Uploaded documents will appear here." />
        ) : (
          <CountGrid
            counts={[
              ['Total', summary.total],
              ['Verified', summary.verified],
              ['Pending', summary.pending],
              ['Mismatch', summary.mismatch],
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** KYC tab (detail screens land with FR-071/072). */
function KycSummaryCard({ summary }: { summary: Lead360Response['kycSummary'] }): ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">KYC verifications</CardTitle>
      </CardHeader>
      <CardContent>
        {summary.total === 0 ? (
          <EmptyState title="No KYC checks yet" />
        ) : (
          <CountGrid
            counts={[
              ['Total', summary.total],
              ['Success', summary.success],
              ['Failed', summary.failed],
              ['Exception', summary.exception],
              ['Initiated', summary.initiated],
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** Tasks tab (task detail lands with FR-100). */
function OpenTasksSummary({ count }: { count: number }): ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Open tasks</CardTitle>
      </CardHeader>
      <CardContent>
        {count === 0 ? (
          <EmptyState title="No open tasks" />
        ) : (
          <p className="text-2xl font-semibold">{count}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Consent tab (full ledger lands with FR-110). */
function ConsentCoverageList({
  items,
}: {
  items: Lead360Response['consentSummary'];
}): ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Consent coverage</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState title="No consents recorded" />
        ) : (
          <ul className="space-y-2 text-sm">
            {items.map((item) => (
              <li key={item.purpose} className="flex items-center justify-between gap-4">
                <span>{item.purpose.replaceAll('_', ' ')}</span>
                <StatusChip status={item.state} label="Consent state" />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function LosTab({ lead }: { lead: Lead360Response }): ReactElement {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <EligibilitySnapshotCard snapshot={lead.eligibilitySnapshot} />
      <LOSMirrorCard mirror={lead.losApplicationMirror} />
    </div>
  );
}

function EligibilitySnapshotCard({
  snapshot,
}: {
  snapshot: Lead360Response['eligibilitySnapshot'];
}): ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Eligibility</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {snapshot === null ? (
          <EmptyState title="No eligibility check yet" />
        ) : (
          <>
            <Field label="Status">
              <StatusChip status={snapshot.status} />
            </Field>
            <Field label="Indicative amount">
              {snapshot.indicativeAmount ?? <Muted>—</Muted>}
            </Field>
            <Field label="Tenure">
              {snapshot.tenureMonths !== null ? `${snapshot.tenureMonths} months` : <Muted>—</Muted>}
            </Field>
            <Field label="Rate range">{snapshot.rateRange ?? <Muted>—</Muted>}</Field>
            <Field label="Valid until">
              {snapshot.validityUntil ? formatDateTime(snapshot.validityUntil) : <Muted>—</Muted>}
            </Field>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LOSMirrorCard({ mirror }: { mirror: Lead360Response['losApplicationMirror'] }): ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">LOS application</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {mirror === null ? (
          <EmptyState title="Not handed off yet" />
        ) : (
          <>
            <Field label="Application ID">{mirror.losApplicationId}</Field>
            <Field label="Status">
              <StatusChip status={mirror.status} />
            </Field>
            <Field label="As of">{formatDateTime(mirror.statusDate)}</Field>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Audit tab — the explorer itself is FR-123's screen (not yet routed). */
function AuditTab(): ReactElement {
  return (
    <Card>
      <CardContent className="pt-6">
        <EmptyState
          title="Audit trail"
          message="Every change to this lead is recorded in the audit explorer (FR-123)."
        />
      </CardContent>
    </Card>
  );
}

/** Collapsible notes timeline, visible under every tab (LLD tree). */
function NotesTimeline({ notes }: { notes: Lead360Response['notes'] }): ReactElement {
  const [open, setOpen] = useState(true);
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Notes</CardTitle>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={open}
            aria-controls="lead360-notes"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
            {open ? 'Collapse' : 'Expand'}
          </Button>
        </div>
      </CardHeader>
      {open ? (
        <CardContent id="lead360-notes">
          {notes.length === 0 ? (
            <EmptyState title="No notes yet" />
          ) : (
            <ol className="space-y-3 text-sm">
              {notes.map((note) => (
                <li key={note.noteId} className="rounded-md border p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatDateTime(note.createdAt)}</span>
                    {note.isInternal ? <StatusChip status="internal" label="Visibility" /> : null}
                  </div>
                  <p>{note.body}</p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}

// ── tiny presentational helpers ─────────────────────────────────────────────

/**
 * WCAG 2.1 AA 1.3.1 — each label is programmatically associated with its value
 * via <dl>/<dt>/<dd> semantics (definition list term → definition description).
 */
function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <dl className="flex items-baseline justify-between gap-4 sm:block">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0">{children}</dd>
    </dl>
  );
}

function Muted({ children }: { children: ReactNode }): ReactElement {
  return <span className="text-muted-foreground">{children}</span>;
}

function CountGrid({ counts }: { counts: readonly (readonly [string, number])[] }): ReactElement {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      {counts.map(([label, value]) => (
        <div key={label} className="rounded-md border p-3">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-xl font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatDateTime(iso: string): string {
  return format(new Date(iso), 'dd MMM yyyy, HH:mm');
}
