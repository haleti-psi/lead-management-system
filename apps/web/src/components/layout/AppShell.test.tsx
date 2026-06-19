// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RoleCode, DataScope } from '@lms/shared';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  user: { userId: 'u-1', orgId: 'o-1', role: 'RM' as RoleCode, scope: 'O' as DataScope },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: mocks.user, logout: mocks.logout }),
}));

import { AppShell } from './AppShell';

function renderShell(): void {
  render(
    <MemoryRouter>
      <AppShell />
    </MemoryRouter>,
  );
}

/** Query the desktop sidebar nav specifically (mobile nav duplicates labels). */
function sidebar(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Primary' });
}

describe('AppShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { userId: 'u-1', orgId: 'o-1', role: 'RM', scope: 'O' };
  });

  it('shows an RM the capabilities they hold and hides admin-only items', () => {
    renderShell();
    const nav = sidebar();
    expect(within(nav).getByText('Dashboard')).toBeTruthy();
    expect(within(nav).getByText('Leads')).toBeTruthy(); // view_lead
    expect(within(nav).getByText('Reports')).toBeTruthy(); // reports
    expect(within(nav).queryByText('Users')).toBeNull(); // user_mgmt — ADMIN only
    expect(within(nav).queryByText('Configuration')).toBeNull(); // configuration — not RM
    expect(within(nav).queryByText('Audit')).toBeNull(); // holds audit_trail, but Audit Explorer is DPO/ADMIN-only
  });

  it('shows an ADMIN the admin items and hides lead-centric ones', () => {
    mocks.user = { userId: 'u-9', orgId: 'o-1', role: 'ADMIN', scope: 'A' };
    renderShell();
    const nav = sidebar();
    expect(within(nav).getByText('Users')).toBeTruthy(); // user_mgmt
    expect(within(nav).getByText('Configuration')).toBeTruthy(); // configuration
    expect(within(nav).queryByText('Leads')).toBeNull(); // ADMIN lacks view_lead
    expect(within(nav).getByText('Audit')).toBeTruthy(); // Audit Explorer — DPO/ADMIN-only
  });

  it('signs out via the top bar', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: /Sign out/ }));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });
});
