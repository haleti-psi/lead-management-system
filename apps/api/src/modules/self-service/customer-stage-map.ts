import { LeadStage } from '@lms/shared';

interface StageDisplay {
  label: string;
  description: string;
}

/**
 * FR-062 — customer-safe stage map (LLD §Data Operations 1). Internal `lead_stage`
 * values are NEVER exposed to customers; each maps to a friendly label + message.
 */
export const CUSTOMER_STAGE_MAP: Readonly<Record<LeadStage, StageDisplay>> = {
  [LeadStage.CAPTURED]: { label: 'Application Received', description: 'We have received your details and are processing your request.' },
  [LeadStage.CONSENT_PENDING]: { label: 'Action Required', description: 'Please confirm your consent to allow us to process your application.' },
  [LeadStage.ASSIGNED]: { label: 'Under Review', description: 'A representative has been assigned and will contact you shortly.' },
  [LeadStage.FIRST_CONTACT_PENDING]: { label: 'Under Review', description: 'A representative has been assigned and will contact you shortly.' },
  [LeadStage.CONTACTED]: { label: 'In Progress', description: 'We are reviewing your application.' },
  [LeadStage.QUALIFIED]: { label: 'In Progress', description: 'We are reviewing your application.' },
  [LeadStage.DOCUMENTS_PENDING]: { label: 'Documents Required', description: 'We need a few documents from you before we can proceed.' },
  [LeadStage.KYC_IN_PROGRESS]: { label: 'Verification In Progress', description: 'We are verifying your identity. This may take a short while.' },
  [LeadStage.ELIGIBILITY_REQUESTED]: { label: 'Assessment In Progress', description: "We are assessing your eligibility. We'll update you soon." },
  [LeadStage.READY_FOR_HANDOFF]: { label: 'Assessment Complete', description: 'Your application has been reviewed and is being prepared for the next step.' },
  [LeadStage.HANDED_OFF]: { label: 'With Lending Team', description: 'Your application has been submitted to our lending partner for processing.' },
  [LeadStage.REJECTED]: { label: 'Not Proceeding', description: 'We are unable to proceed with your application at this time.' },
  [LeadStage.DORMANT]: { label: 'On Hold', description: 'Your application is currently on hold. We will reach out to you.' },
};

/** Stages where a callback request is not meaningful (LLD §Validation lead-state guard). */
export const CALLBACK_BLOCKED_STAGES: ReadonlySet<string> = new Set([LeadStage.HANDED_OFF, LeadStage.REJECTED]);
