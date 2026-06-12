import type {
  DupAction,
  DupRecordStatus,
  DupStatus,
  LeadStage,
  MatchConfidence,
} from '@lms/shared';

/**
 * FR-020 — wire shapes for `POST /leads/{id}/duplicate-check` (LLD §Response —
 * 200 OK). `name`/`mobile`/`pan_masked` carry the matched lead's display
 * identity for the duplicate-warning modal; they are masked per the caller's
 * role by the global `MaskingInterceptor` (FIELD_MAP keys) before
 * serialisation — raw values never leave the API (T24). `pan_token` is never
 * exposed.
 */
export interface DuplicateMatchResponseDto {
  /** Null only on a path that did not persist (the 409 detail uses its own shape). */
  duplicate_match_id: string | null;
  matched_lead_id: string;
  matched_lead_code: string;
  confidence: MatchConfidence;
  matched_on: readonly string[];
  action: DupAction;
  status: DupRecordStatus;
  stage: LeadStage;
  name: string | null;
  mobile: string | null;
  pan_masked: string | null;
}

export interface DuplicateCheckResponseDto {
  lead_id: string;
  duplicate_status: DupStatus;
  /** Past-tense action applied to the open matches; null when no match found. */
  action_taken: DupAction | null;
  matches: DuplicateMatchResponseDto[];
}
