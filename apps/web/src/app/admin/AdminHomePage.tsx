import { Link } from 'react-router-dom';
import {
  Boxes,
  ChevronRight,
  FileText,
  MessageSquare,
  PackageOpen,
  ShieldAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/PageHeader';

/**
 * Configuration hub at `/admin` (capability `configuration`): a landing page
 * that links out to the individual admin/configuration consoles. The nav's
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
    icon: MessageSquare,
  },
];

export function AdminHomePage(): JSX.Element {
  return (
    <div className="space-y-6">
      <PageHeader title="Configuration" description="Administration and configuration consoles." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ADMIN_LINKS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="group animate-fade-in-up rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="flex h-full items-start gap-3 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-accent/40 hover:shadow-md">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary transition-transform duration-200 group-hover:scale-110"
                aria-hidden
              >
                <item.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-none">{item.label}</p>
                <p className="mt-1.5 text-sm text-muted-foreground">{item.description}</p>
              </div>
              <ChevronRight
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
