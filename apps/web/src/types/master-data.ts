/**
 * FR-131 — Master Configuration UI types.
 *
 * The generic `/admin/{masterResource}` API dispatches to one of the allow-listed
 * master resources. The slug list MUST mirror the backend `MASTER_SLUGS`
 * allow-list (apps/api/src/modules/admin/master/master.constants.ts) — resources
 * owned by another FR's concrete controller (partners, sla-policies, schemes,
 * allocation-rules, communication-templates, retention-policies, dla-registry,
 * users/roles/teams, product-configs, webhooks, break-glass) are deliberately
 * NOT here. Each resource's row view / create body / patch body mirrors that
 * resource's descriptor (descriptors.ts) and Zod DTO.
 */

/** The master resources FR-131 owns. Mirrors backend `MASTER_SLUGS`. */
export const MASTER_SLUGS = [
  'regions',
  'branches',
  'rejection-reasons',
  'business-calendars',
] as const;

export type MasterSlug = (typeof MASTER_SLUGS)[number];

/**
 * How a resource models "active". Drives whether a deactivate action and an
 * `is_active` column are shown:
 *  - `none`    — no activeness (regions can never be deactivated).
 *  - `boolean` — an `is_active` flag (branches, rejection-reasons, calendars).
 */
export type ActivenessModel = 'none' | 'boolean';

/** Fields every master row view carries (the descriptor's shared projection). */
export interface MasterRecordBase {
  id: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ───────────────────────── per-resource row views ─────────────────────────

/** `regions` (global, no activeness). */
export interface RegionView extends MasterRecordBase {
  regionId: string;
  code: string;
  name: string;
}

/** A `{start,end}` HH:MM window, or null for a non-working day. */
export interface DayHours {
  start: string;
  end: string;
}
export type WorkingHours = Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', DayHours | null>;
export interface Holiday {
  date: string;
  name: string;
}

/** `branches` (branch-scoped, is_active). */
export interface BranchView extends MasterRecordBase {
  branchId: string;
  code: string;
  name: string;
  regionId: string;
  pinCodes: string[] | null;
  address: string | null;
}

/** `rejection-reasons` (global, is_active). */
export interface RejectionReasonView extends MasterRecordBase {
  rejectionReasonId: string;
  primaryReason: string;
  subReason: string | null;
  requiresRemarks: boolean;
}

/** `business-calendars` (branch-scoped, is_active). */
export interface BusinessCalendarView extends MasterRecordBase {
  businessCalendarId: string;
  code: string;
  name: string;
  timezone: string;
  branchId: string | null;
  regionId: string | null;
  workingHours: WorkingHours;
  holidays: Holiday[] | null;
}

/** Any master row (the generic list is rendered over this). */
export type MasterRecordView =
  | RegionView
  | BranchView
  | RejectionReasonView
  | BusinessCalendarView;

// ───────────────────────── create / patch request bodies ─────────────────────────

export interface CreateRegionBody {
  code: string;
  name: string;
}
export type PatchRegionBody = Partial<CreateRegionBody>;

export interface CreateBranchBody {
  code: string;
  name: string;
  regionId: string;
  pinCodes?: string[];
  address?: string;
}
export type PatchBranchBody = Partial<CreateBranchBody> & { isActive?: boolean };

export interface CreateRejectionReasonBody {
  primaryReason: string;
  subReason?: string;
  requiresRemarks?: boolean;
}
export type PatchRejectionReasonBody = Partial<CreateRejectionReasonBody> & { isActive?: boolean };

export interface CreateBusinessCalendarBody {
  code: string;
  name: string;
  timezone?: string;
  branchId?: string;
  regionId?: string;
  workingHours: WorkingHours;
  holidays?: Holiday[];
}
export type PatchBusinessCalendarBody = Partial<CreateBusinessCalendarBody> & { isActive?: boolean };

/** The create body of any resource (the hook is generic over this). */
export type CreateMasterBody =
  | CreateRegionBody
  | CreateBranchBody
  | CreateRejectionReasonBody
  | CreateBusinessCalendarBody;

/** The patch body of any resource. */
export type PatchMasterBody =
  | PatchRegionBody
  | PatchBranchBody
  | PatchRejectionReasonBody
  | PatchBusinessCalendarBody;

/** A create/patch response echoes the record plus the maker-checker version id. */
export type MasterMutationResult = MasterRecordView & { configVersionId: string };

/**
 * Static, per-resource UI metadata (label, activeness model). Mirrors each
 * descriptor; drives the resource selector and whether a Deactivate affordance is
 * shown. Column/form rendering is resource-specific (see the page/forms).
 */
export interface MasterResourceMeta {
  slug: MasterSlug;
  /** Human label for the selector and page header. */
  label: string;
  /** Singular noun used in buttons/toasts ("Add region", "region created"). */
  singular: string;
  activeness: ActivenessModel;
}

export const MASTER_RESOURCES: Readonly<Record<MasterSlug, MasterResourceMeta>> = {
  regions: { slug: 'regions', label: 'Regions', singular: 'region', activeness: 'none' },
  branches: { slug: 'branches', label: 'Branches', singular: 'branch', activeness: 'boolean' },
  'rejection-reasons': {
    slug: 'rejection-reasons',
    label: 'Rejection Reasons',
    singular: 'rejection reason',
    activeness: 'boolean',
  },
  'business-calendars': {
    slug: 'business-calendars',
    label: 'Business Calendars',
    singular: 'business calendar',
    activeness: 'boolean',
  },
};

/** The selector options, in display order. */
export const MASTER_RESOURCE_LIST: readonly MasterResourceMeta[] = MASTER_SLUGS.map(
  (slug) => MASTER_RESOURCES[slug],
);
