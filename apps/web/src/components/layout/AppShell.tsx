import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3,
  CheckCircle2,
  LayoutDashboard,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  Upload,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/brand/Logo';
import { useAuth } from '@/hooks/use-auth';
import { useCan, type Capability } from '@/lib/auth/capabilities';
import { cn } from '@/lib/utils';
import { SearchPalette } from '@/components/workspace/SearchPalette';
import { ThemeToggle } from './ThemeToggle';

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
  { label: 'Import', path: '/import', icon: Upload, capability: 'bulk_action' },
  { label: 'Approvals', path: '/approvals', icon: CheckCircle2, capability: 'approve_lead' },
  { label: 'Reports', path: '/reports', icon: BarChart3, capability: 'reports' },
  { label: 'Audit', path: '/audit', icon: ShieldCheck, capability: 'audit_trail' },
  { label: 'Configuration', path: '/admin', icon: Settings, capability: 'configuration' },
  { label: 'Users', path: '/users', icon: UserCog, capability: 'user_mgmt' },
];

function useVisibleNav(): NavItem[] {
  const can = useCan();
  return NAV_ITEMS.filter((item) => !item.capability || can(item.capability));
}

/** Two-letter avatar initials from a role code (the only identity field the
 * session is guaranteed to carry). */
function roleInitials(role: string | undefined): string {
  if (!role) return '··';
  return role.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase() || '··';
}

function NavList({ items }: { items: NavItem[] }): JSX.Element {
  return (
    <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto p-3">
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          className={({ isActive }) =>
            cn(
              'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )
          }
        >
          {({ isActive }) => (
            <>
              <span
                className={cn(
                  'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary transition-opacity',
                  isActive ? 'opacity-100' : 'opacity-0',
                )}
                aria-hidden
              />
              <item.icon
                className={cn('h-4 w-4 shrink-0 transition-transform group-hover:scale-110')}
                aria-hidden
              />
              <span className="truncate">{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function Sidebar({ items, role, scope }: { items: NavItem[]; role?: string; scope?: string }): JSX.Element {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-16 shrink-0 items-center border-b px-5">
        <Logo />
      </div>
      <NavList items={items} />
      <div className="shrink-0 border-t p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20"
            aria-hidden
          >
            {roleInitials(role)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{role ?? 'Signed in'}</p>
            <p className="truncate text-xs text-muted-foreground">Scope {scope ?? '—'}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function TopBar({ onSearchOpen }: { onSearchOpen: () => void }): JSX.Element {
  const { logout } = useAuth();
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-4 border-b bg-card/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      {/* FR-054 — Global search trigger (⌘K / Ctrl+K). */}
      <button
        type="button"
        aria-label="Search (⌘K)"
        onClick={onSearchOpen}
        className="relative hidden h-9 max-w-sm flex-1 items-center gap-2 rounded-lg border border-input bg-background/60 px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex"
      >
        <Search className="h-4 w-4" aria-hidden />
        <span>Search leads, partners…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium sm:inline-block">
          ⌘K
        </kbd>
      </button>
      {/* Mobile search icon. */}
      <button
        type="button"
        aria-label="Search"
        onClick={onSearchOpen}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-input transition-colors hover:bg-accent sm:hidden"
      >
        <Search className="h-4 w-4" aria-hidden />
      </button>
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <Button variant="outline" size="sm" onClick={logout} aria-label="Sign out">
          <LogOut className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Sign out</span>
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
              'relative flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )
          }
        >
          {({ isActive }) => (
            <>
              <span
                className={cn(
                  'absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary transition-opacity',
                  isActive ? 'opacity-100' : 'opacity-0',
                )}
                aria-hidden
              />
              <item.icon className="h-5 w-5" aria-hidden />
              {item.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell(): JSX.Element {
  const items = useVisibleNav();
  const { user } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // FR-054 — global cmd-k / ctrl-k keyboard shortcut to open the search palette.
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <Sidebar items={items} role={user?.role} scope={user?.scope} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onSearchOpen={openSearch} />
        <main className="flex-1 overflow-y-auto bg-muted/30">
          <div className="container mx-auto px-4 py-6">
            <Outlet />
          </div>
        </main>
        <MobileNav items={items} />
      </div>
      {/* FR-054 — Search palette (portal-like; rendered at AppShell level). */}
      <SearchPalette open={searchOpen} onClose={closeSearch} />
    </div>
  );
}
