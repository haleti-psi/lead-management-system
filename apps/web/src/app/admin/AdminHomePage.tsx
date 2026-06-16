import { Link } from 'react-router-dom';
import {
  Boxes,
  FileText,
  KeyRound,
  PackageOpen,
  ShieldAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Configuration hub at `/admin` (capability `configuration`): a simple landing
 * page that links out to the individual admin/configuration consoles. The nav's
 * "Configuration" item points here; each section is also guarded by `AbacGuard`
 * on the API, so this is a convenience index only.
 */
interface AdminLink {
  label: string;
  description: string;
  to: string;
  icon: LucideIcon;
}

const ADMIN_LINKS: readonly AdminLink[] = [
  {
    label: 'Master data',
    description: 'Branches, products, sources and other reference lists.',
    to: '/admin/master',
    icon: Boxes,
  },
  {
    label: 'Product configuration',
    description: 'Product eligibility rules and intake field configuration.',
    to: '/admin/products',
    icon: PackageOpen,
  },
  {
    label: 'Schemes & governance',
    description: 'Review and approve pending configuration changes (maker-checker).',
    to: '/admin/config',
    icon: FileText,
  },
  {
    label: 'Partners',
    description: 'DSA / dealer onboarding and partner administration.',
    to: '/admin/partners',
    icon: Users,
  },
  {
    label: 'Break-glass',
    description: 'Emergency elevated-access requests and approvals.',
    to: '/admin/break-glass',
    icon: ShieldAlert,
  },
  {
    label: 'Communication templates',
    description: 'Manage SMS / email / WhatsApp message templates.',
    to: '/admin/templates',
    icon: KeyRound,
  },
];

export function AdminHomePage(): JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Configuration</h1>
        <p className="text-sm text-muted-foreground">
          Administration and configuration consoles.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ADMIN_LINKS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full transition-colors hover:bg-accent">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <item.icon className="h-5 w-5 text-muted-foreground" aria-hidden />
                  <CardTitle>{item.label}</CardTitle>
                </div>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
