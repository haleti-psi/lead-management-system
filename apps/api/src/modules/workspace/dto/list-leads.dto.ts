import { z } from 'zod';

import {
  ConsentStatus,
  KycStatus,
  LeadSource,
  LeadStage,
  Priority,
  ProductCode,
} from '@lms/shared';

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../../core/common';

/**
 * FR-050 — `GET /leads` query grammar (LLD §Validation Logic). The
 * `FILTER_ALLOWLIST` / `SORT_ALLOWLIST` here are the single source of truth,
 * shared by the list query AND saved-view `filter_json` validation: a saved
 * view is just a persisted instance of the same filter grammar.
 */

export const FILTER_ALLOWLIST = [
  'product_code',
  'stage',
  'branch_id',
  'team_id',
  'owner_id',
  'source',
  'partner',
  'priority',
  'consent_status',
  'kyc_status',
  'is_hot',
  'score_band',
  'sla_state',
  'date_from',
  'date_to',
] as const;
export type FilterKey = (typeof FILTER_ALLOWLIST)[number];

export const SORT_ALLOWLIST = [
  'lead_code',
  'created_at',
  'updated_at',
  'score',
  'stage',
  'priority',
  'sla_first_contact_due_at',
] as const;
export type SortField = (typeof SORT_ALLOWLIST)[number];
export type SortDir = 'asc' | 'desc';

export const DEFAULT_SORT = 'created_at:desc';

export const SCORE_BANDS = ['hot', 'warm', 'cold', 'unscored'] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export const SLA_STATES = ['breached', 'due_soon', 'ok', 'none'] as const;
export type SlaState = (typeof SLA_STATES)[number];

const STAGE_VALUES = Object.values(LeadStage) as [LeadStage, ...LeadStage[]];
const PRODUCT_CODE_VALUES = Object.values(ProductCode) as [ProductCode, ...ProductCode[]];
const SOURCE_VALUES = Object.values(LeadSource) as [LeadSource, ...LeadSource[]];
const PRIORITY_VALUES = Object.values(Priority) as [Priority, ...Priority[]];
const CONSENT_STATUS_VALUES = Object.values(ConsentStatus) as [ConsentStatus, ...ConsentStatus[]];
const KYC_STATUS_VALUES = Object.values(KycStatus) as [KycStatus, ...KycStatus[]];

/** Single enum value or array of them (query `filter[stage]=a&filter[stage]=b`
 *  and saved-view JSON `{"stage":["a","b"]}` both normalise to an array). */
function enumValueOrArray<T extends string>(values: [T, ...T[]], message: string) {
  const single = z.enum(values, { errorMap: () => ({ message }) });
  return z
    .union([single, z.array(single).min(1, message)], { errorMap: () => ({ message }) })
    .transform((v): T[] => (Array.isArray(v) ? v : [v]));
}

/** Boolean for both wire forms: JSON `true/false` and query-string `'true'/'false'`. */
const Booleanish = z.union(
  [z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')],
  { errorMap: () => ({ message: 'is_hot must be true/false' }) },
);

const IsoDate = z.coerce.date({ errorMap: () => ({ message: 'must be a valid ISO date' }) });

const Uuid = z.string({ invalid_type_error: 'must be a valid id' }).uuid('must be a valid id');

/**
 * Builds the allow-listed filter object schema. `unknownKeyMessage` lets the
 * two consumers keep their LLD-specified wording: the list query reports
 * `unknown filter '<key>'`; saved views report the unsupported-filter message.
 */
export function buildLeadFilterSchema(unknownKeyMessage: (keys: string[]) => string) {
  return z
    .object(
      {
        product_code: enumValueOrArray(PRODUCT_CODE_VALUES, 'invalid product_code value').optional(),
        stage: enumValueOrArray(STAGE_VALUES, 'invalid stage value').optional(),
        branch_id: Uuid.optional(),
        team_id: Uuid.optional(),
        owner_id: Uuid.optional(),
        source: z.enum(SOURCE_VALUES, { errorMap: () => ({ message: 'invalid source value' }) }).optional(),
        partner: z
          .string({ invalid_type_error: 'must be a valid id' })
          .min(1, 'must be a valid id')
          .max(40, 'must be a valid id')
          .optional(),
        priority: z.enum(PRIORITY_VALUES, { errorMap: () => ({ message: 'invalid priority value' }) }).optional(),
        consent_status: z
          .enum(CONSENT_STATUS_VALUES, { errorMap: () => ({ message: 'invalid consent_status value' }) })
          .optional(),
        kyc_status: z
          .enum(KYC_STATUS_VALUES, { errorMap: () => ({ message: 'invalid kyc_status value' }) })
          .optional(),
        is_hot: Booleanish.optional(),
        score_band: z.enum(SCORE_BANDS, { errorMap: () => ({ message: 'invalid score_band' }) }).optional(),
        sla_state: z.enum(SLA_STATES, { errorMap: () => ({ message: 'invalid sla_state' }) }).optional(),
        date_from: IsoDate.optional(),
        date_to: IsoDate.optional(),
      },
      {
        errorMap: (issue, ctx) => {
          if (issue.code === z.ZodIssueCode.unrecognized_keys) {
            return { message: unknownKeyMessage(issue.keys) };
          }
          if (issue.code === z.ZodIssueCode.invalid_type) {
            return { message: 'filter must be an object of allow-listed keys' };
          }
          return { message: ctx.defaultError };
        },
      },
    )
    .strict()
    .superRefine((f, ctx) => {
      if (f.date_from && f.date_to && f.date_from > f.date_to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['date_from'],
          message: 'date_from must be ≤ date_to',
        });
      }
    });
}

/** List-query variant: unknown keys read `unknown filter '<key>'` (LLD table). */
export const LeadFilterSchema = buildLeadFilterSchema((keys) =>
  keys.map((k) => `unknown filter '${k}'`).join('; '),
);
export type LeadFilter = z.infer<typeof LeadFilterSchema>;

/**
 * `GET /leads` query string (LLD §Endpoint 1). `limit` over 100 is CLAMPED to
 * 100 — never an error (BRD FR-050 edge case); `limit < 1` rejects. `sort`
 * must name an allow-listed field. `q` needs ≥ 2 characters.
 */
export const ListLeadsQuerySchema = z.object({
  page: z.coerce
    .number({ invalid_type_error: 'page must be a positive integer' })
    .int('page must be a positive integer')
    .min(1, 'page must be a positive integer')
    .default(1),
  limit: z.coerce
    .number({ invalid_type_error: 'limit must be a positive integer' })
    .int('limit must be a positive integer')
    .min(1, 'limit must be a positive integer')
    .transform((v) => Math.min(v, MAX_PAGE_LIMIT))
    .default(DEFAULT_PAGE_LIMIT),
  sort: z
    .string({ invalid_type_error: 'sort field is not allowed' })
    .default(DEFAULT_SORT)
    .transform((value, ctx): { field: SortField; dir: SortDir } => {
      const [field, dir] = value.split(':');
      const sortField = SORT_ALLOWLIST.find((f) => f === field);
      if (!sortField || (dir !== 'asc' && dir !== 'desc')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'sort field is not allowed' });
        return z.NEVER;
      }
      return { field: sortField, dir };
    }),
  q: z
    .string({ invalid_type_error: 'search needs at least 2 characters' })
    .trim()
    .min(2, 'search needs at least 2 characters')
    .optional(),
  filter: LeadFilterSchema.default({}),
});
export type ListLeadsQuery = z.infer<typeof ListLeadsQuerySchema>;

/**
 * FR-052 — `GET /pipeline-board` query. One Kanban column per request:
 * `stage` is required; `limit` is clamped to 100 (≤ MAX_PAGE_LIMIT), default 25.
 * The board projection is richer than the contract `Lead` list (adds requested
 * amount, owner name, ageing and the optimistic-lock version).
 */
export const BoardColumnQuerySchema = z.object({
  stage: z.enum(STAGE_VALUES, { errorMap: () => ({ message: 'invalid stage value' }) }),
  page: z.coerce
    .number({ invalid_type_error: 'page must be a positive integer' })
    .int('page must be a positive integer')
    .min(1, 'page must be a positive integer')
    .default(1),
  limit: z.coerce
    .number({ invalid_type_error: 'limit must be a positive integer' })
    .int('limit must be a positive integer')
    .min(1, 'limit must be a positive integer')
    .transform((v) => Math.min(v, MAX_PAGE_LIMIT))
    .default(DEFAULT_PAGE_LIMIT),
});
export type BoardColumnQuery = z.infer<typeof BoardColumnQuerySchema>;
