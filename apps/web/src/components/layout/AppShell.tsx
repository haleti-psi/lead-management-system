import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useCan, type Capability } from '@/lib/auth/capabilities';
import { cn } from '@/lib/utils';

/**
 * Authenticated app shell (ui.md §Layout shell): role-filtered left nav, a top
 * bar (brand, global search, profile/sign-out), and a mobile bottom nav for core
 * actions. Routes/screens are added per FR; nav items are gated by capability so
 * each role only sees what it can use. Full-height uses 100dvh (never 100vh).
 *
 * Stubs to be wired by later pieces/FRs: the global masked search (FR-050/054),
 * quick-create and the notifications bell (need the DropdownMenu/Drawer
 * primitives), and the "More" overflow on mobile.
 */
interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** When set, the item only shows if the role has this capability. */
  capability?: Capability;
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Leads', path: '/leads', icon: Users, capability: 'view_lead' },
  { label: 'KYC & Docs', path: '/kyc', icon: FileCheck2, capability: 'verify_doc' },
  { label: 'Reports', path: '/reports', icon: BarChart3, capability: 'reports' },
  { label: 'Audit', path: '/audit', icon: ShieldCheck, capability: 'audit_trail' },
  { label: 'Configuration', path: '/admin', icon: Settings, capability: 'configuration' },
  { label: 'Users', path: '/users', icon: UserCog, capability: 'user_mgmt' },
];

function useVisibleNav(): NavItem[] {
  const can = useCan();
  return NAV_ITEMS.filter((item) => !item.capability || can(item.capability));
}

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
  );

function Sidebar({ items }: { items: NavItem[] }): JSX.Element {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card md:block">
      <div className="flex h-14 items-center border-b px-4 font-semibold">LMS</div>
      <nav aria-label="Primary" className="space-y-1 p-2">
        {items.map((item) => (
          <NavLink key={item.path} to={item.path} end={item.path === '/'} className={navLinkClass}>
            <item.icon className="h-4 w-4" aria-hidden />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

function TopBar(): JSX.Element {
  const { user, logout } = useAuth();
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-card px-4">
      <div className="relative hidden max-w-sm flex-1 sm:block">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
        <input
          type="search"
          aria-label="Search"
          placeholder="Search leads, partners…"
          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="ml-auto flex items-center gap-3">
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {user?.role} · scope {user?.scope}
        </span>
        <Button variant="outline" size="sm" onClick={logout}>
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </Button>
      </div>
    </header>
  );
}

function MobileNav({ items }: { items: NavItem[] }): JSX.Element {
  return (
    <nav
      aria-label="Primary mobile"
      className="flex shrink-0 items-stretch border-t bg-card md:hidden"
    >
      {items.slice(0, 5).map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px]',
              isActive ? 'text-foreground' : 'text-muted-foreground',
            )
          }
        >
          <item.icon className="h-5 w-5" aria-hidden />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell(): JSX.Element {
  const items = useVisibleNav();
  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <Sidebar items={items} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto">
          <div className="container mx-auto px-4 py-6">
            <Outlet />
          </div>
        </main>
        <MobileNav items={items} />
      </div>
    </div>
  );
}
