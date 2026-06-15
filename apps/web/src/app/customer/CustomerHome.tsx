import { Link } from 'react-router-dom';
import { FileUp, ShieldCheck, Info, MessageSquareWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/StatusChip';
import type { CustomerOpenData } from '@/types/customer-link';

/**
 * FR-060 §UI — purpose-gated customer home (shown after OTP verification). Each
 * card appears only when its action is in the link's `purpose`. Upload links to
 * the existing customer upload page (FR-070); consent/status capture UIs land
 * with FR-110/FR-062 (informational cards here meanwhile).
 */
export function CustomerHome({ token, data }: { token: string; data: CustomerOpenData }): JSX.Element {
  const has = (p: string): boolean => data.purpose.includes(p);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{data.lead_display.product_display_name}</p>
        </div>
        <StatusChip label={data.lead_display.status_label} tone="info" />
      </div>

      {has('upload') ? (
        <Card icon={<FileUp className="h-5 w-5" aria-hidden />} title="Upload documents" description="Securely upload the documents requested for your application.">
          <Button asChild className="w-full">
            <Link to={`/c/${token}/upload`}>Upload a document</Link>
          </Button>
        </Card>
      ) : null}

      {has('consent') ? (
        <Card icon={<ShieldCheck className="h-5 w-5" aria-hidden />} title="Consent" description="Review and provide the consents required to process your application.">
          <p className="text-sm text-muted-foreground">Consent capture will be available here shortly.</p>
        </Card>
      ) : null}

      {has('status') ? (
        <Card icon={<Info className="h-5 w-5" aria-hidden />} title="Application status" description="Track the progress of your application.">
          <Button asChild variant="outline" className="w-full">
            <Link to={`/c/${token}/status`}>View status</Link>
          </Button>
        </Card>
      ) : null}

      {has('grievance') ? (
        <Card icon={<MessageSquareWarning className="h-5 w-5" aria-hidden />} title="Raise a grievance" description="Let us know about any concern with your application.">
          <Button asChild variant="outline" className="w-full">
            <Link to={`/c/${token}/grievance`}>Raise a grievance</Link>
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

function Card({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border p-4">
      <div className="mb-3 flex items-start gap-3">
        <span className="text-muted-foreground">{icon}</span>
        <div>
          <h2 className="font-medium">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
