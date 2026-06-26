import type { ReactElement } from 'react';
import { useAuth } from '@/hooks/use-auth';

/**
 * FR-053 — personalised dashboard welcome hero. Presentation only: it reads the
 * existing auth session (never mutates it). The access-token carries no display
 * name (only id/role/scope), so the user is greeted by a friendly role label;
 * if a `name` claim is added later it can slot straight into `who`.
 */
const ROLE_LABEL: Readonly<Record<string, string>> = {
  RM: 'Relationship Manager',
  BM: 'Branch Manager',
  SM: 'Sales Manager',
  HEAD: 'Business Head',
  KYC: 'KYC Officer',
  ADMIN: 'Administrator',
  DPO: 'Data Protection Officer',
  PARTNER: 'Partner',
  CUSTOMER: 'Customer',
};

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const DATE_FMT = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});

export function WelcomeBanner(): ReactElement {
  const { user } = useAuth();
  const who = user?.role ? (ROLE_LABEL[user.role] ?? user.role) : null;

  return (
    <section
      className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      aria-label="Welcome"
    >
      {/* Soft brand wash — subtle, theme-aware, never overwhelming. */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent"
        aria-hidden
      />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-xl shadow-sm sm:flex"
            aria-hidden
          >
            👋
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
              {timeGreeting()}
              {who ? `, ${who}` : ''}
              <span className="sm:hidden" aria-hidden>
                {' '}
                👋
              </span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Welcome back — here&apos;s what&apos;s happening today.
            </p>
          </div>
        </div>
        <p className="shrink-0 text-xs font-medium text-muted-foreground sm:text-right">
          {DATE_FMT.format(new Date())}
        </p>
      </div>
    </section>
  );
}
