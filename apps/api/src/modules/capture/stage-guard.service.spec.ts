import { LeadStage, RoleCode } from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import type { DbTransaction } from '../../core/db';
import { StageGuardService } from './stage-guard.service';
import type { GuardLeadContext } from './stage-guard.service';

/**
 * FR-052 — unit tests for {@link StageGuardService} (U01, U02 from FR-052-tests.md).
 * Verifies that all §10.3 valid transitions return no failing guards (U01)
 * and all invalid / forbidden transitions return at least one failing guard (U02).
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD_ID = 'b0000000-0000-0000-0000-00000000000b';

function makeUser(role: string): AuthUser {
  return { userId: 'user-1', orgId: ORG, role: role as AuthUser['role'], scope: 'O', jti: 'jti-1' };
}

function makeLead(stage: string, extra?: Partial<GuardLeadContext>): GuardLeadContext {
  return {
    lead_id: LEAD_ID,
    org_id: ORG,
    stage: stage as typeof LeadStage[keyof typeof LeadStage],
    ...extra,
  };
}

/** A minimal tx fake — guard evaluate should not need to query the DB at this tier. */
const fakeTx = {} as DbTransaction;

describe('StageGuardService', () => {
  let service: StageGuardService;

  beforeEach(() => {
    service = new StageGuardService();
  });

  // ── U01: Valid transitions return empty failed[] ─────────────────────────

  describe('U01 — all §10.3 valid transitions pass', () => {
    it('captured → assigned (BM)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.CAPTURED,
        toStage: LeadStage.ASSIGNED,
        lead: makeLead(LeadStage.CAPTURED),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });

    it('assigned → contacted (RM)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.ASSIGNED,
        toStage: LeadStage.CONTACTED,
        lead: makeLead(LeadStage.ASSIGNED),
        actor: makeUser(RoleCode.RM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });

    it('contacted → qualified (BM)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.CONTACTED,
        toStage: LeadStage.QUALIFIED,
        lead: makeLead(LeadStage.CONTACTED),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });

    it('qualified → documents_pending (RM)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.QUALIFIED,
        toStage: LeadStage.DOCUMENTS_PENDING,
        lead: makeLead(LeadStage.QUALIFIED),
        actor: makeUser(RoleCode.RM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });

    it('documents_pending → kyc_in_progress (RM)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.DOCUMENTS_PENDING,
        toStage: LeadStage.KYC_IN_PROGRESS,
        lead: makeLead(LeadStage.DOCUMENTS_PENDING),
        actor: makeUser(RoleCode.RM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });

    it('kyc_in_progress → eligibility_requested (KYC)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.KYC_IN_PROGRESS,
        toStage: LeadStage.ELIGIBILITY_REQUESTED,
        lead: makeLead(LeadStage.KYC_IN_PROGRESS),
        actor: makeUser(RoleCode.KYC),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });

    // FR-055: eligibility_requested now transitions to pending_approval (not ready_for_handoff).
    it('eligibility_requested → pending_approval (BM)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.ELIGIBILITY_REQUESTED,
        toStage: LeadStage.PENDING_APPROVAL,
        lead: makeLead(LeadStage.ELIGIBILITY_REQUESTED),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });

    // FR-055: approver transitions pending_approval → ready_for_handoff.
    it('pending_approval → ready_for_handoff (BM)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.PENDING_APPROVAL,
        toStage: LeadStage.READY_FOR_HANDOFF,
        lead: makeLead(LeadStage.PENDING_APPROVAL),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });

    // FR-055: SM and HEAD can also approve.
    it('pending_approval → ready_for_handoff (SM)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.PENDING_APPROVAL,
        toStage: LeadStage.READY_FOR_HANDOFF,
        lead: makeLead(LeadStage.PENDING_APPROVAL),
        actor: makeUser(RoleCode.SM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });

    it('pending_approval → ready_for_handoff (HEAD)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.PENDING_APPROVAL,
        toStage: LeadStage.READY_FOR_HANDOFF,
        lead: makeLead(LeadStage.PENDING_APPROVAL),
        actor: makeUser(RoleCode.HEAD),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });

    // FR-055: pending_approval → rejected via the generic "any active → rejected" path.
    it('pending_approval → rejected (BM, with reason)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.PENDING_APPROVAL,
        toStage: LeadStage.REJECTED,
        lead: makeLead(LeadStage.PENDING_APPROVAL),
        actor: makeUser(RoleCode.BM),
        reason: 'Credit profile insufficient.',
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });

    it('ready_for_handoff → handed_off (BM)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.READY_FOR_HANDOFF,
        toStage: LeadStage.HANDED_OFF,
        // consent_present requires consent_status='captured';
        // duplicate_clear requires duplicate_status != 'flagged'.
        lead: makeLead(LeadStage.READY_FOR_HANDOFF, { consent_status: 'captured', duplicate_status: 'none' }),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });

    it('assigned → rejected (RM, with reason)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.ASSIGNED,
        toStage: LeadStage.REJECTED,
        lead: makeLead(LeadStage.ASSIGNED),
        actor: makeUser(RoleCode.RM),
        reason: 'Not interested',
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });

    it('contacted → dormant (SM, with reason)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.CONTACTED,
        toStage: LeadStage.DORMANT,
        lead: makeLead(LeadStage.CONTACTED),
        actor: makeUser(RoleCode.SM),
        reason: 'Customer on leave for 3 months',
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });

    it('dormant → assigned (RM)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.DORMANT,
        toStage: LeadStage.ASSIGNED,
        lead: makeLead(LeadStage.DORMANT),
        actor: makeUser(RoleCode.RM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });

    it('rejected → assigned (BM, with reason)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.REJECTED,
        toStage: LeadStage.ASSIGNED,
        lead: makeLead(LeadStage.REJECTED),
        actor: makeUser(RoleCode.BM),
        reason: 'Customer reconsidered',
        tx: fakeTx,
      });
      expect(result.failed).toHaveLength(0);
    });
  });

  // ── U02: Invalid transitions return at least one failing guard ───────────

  describe('U02 — all invalid / forbidden transitions fail', () => {
    it('handed_off → any stage is terminal (CONFLICT path) — guard returns terminal_state', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.HANDED_OFF,
        toStage: LeadStage.CONTACTED,
        lead: makeLead(LeadStage.HANDED_OFF),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toContain('terminal_state');
    });

    it('skip-ahead: captured → qualified fails (invalid_transition)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.CAPTURED,
        toStage: LeadStage.QUALIFIED,
        lead: makeLead(LeadStage.CAPTURED),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toContain('invalid_transition');
    });

    it('skip-ahead: assigned → documents_pending fails', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.ASSIGNED,
        toStage: LeadStage.DOCUMENTS_PENDING,
        lead: makeLead(LeadStage.ASSIGNED),
        actor: makeUser(RoleCode.RM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toContain('invalid_transition');
    });

    it('skip-ahead: captured → handed_off fails', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.CAPTURED,
        toStage: LeadStage.HANDED_OFF,
        lead: makeLead(LeadStage.CAPTURED),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toContain('invalid_transition');
    });

    it('role not permitted: RM cannot do captured → assigned', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.CAPTURED,
        toStage: LeadStage.ASSIGNED,
        lead: makeLead(LeadStage.CAPTURED),
        actor: makeUser(RoleCode.RM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toContain('role_not_permitted');
    });

    it('role not permitted: SM cannot do assigned → contacted', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.ASSIGNED,
        toStage: LeadStage.CONTACTED,
        lead: makeLead(LeadStage.ASSIGNED),
        actor: makeUser(RoleCode.SM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toContain('role_not_permitted');
    });

    it('rejected without reason fails guard', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.ASSIGNED,
        toStage: LeadStage.REJECTED,
        lead: makeLead(LeadStage.ASSIGNED),
        actor: makeUser(RoleCode.RM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toContain('rejection_reason_provided');
    });

    it('dormant without reason fails nurture_reason guard', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.CONTACTED,
        toStage: LeadStage.DORMANT,
        lead: makeLead(LeadStage.CONTACTED),
        actor: makeUser(RoleCode.RM),
        reason: undefined,
        tx: fakeTx,
      });
      expect(result.failed).toContain('nurture_reason');
    });

    it('handed_off → dormant is also blocked (terminal state)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.HANDED_OFF,
        toStage: LeadStage.DORMANT,
        lead: makeLead(LeadStage.HANDED_OFF),
        actor: makeUser(RoleCode.BM),
        reason: 'test',
        tx: fakeTx,
      });
      // handed_off is terminal — the toStage=dormant path is intercepted by the
      // dormant handler which checks fromStage !== HANDED_OFF.
      expect(result.failed.length).toBeGreaterThan(0);
    });

    it('dormant → ineligible target (dormant → documents_pending) fails', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.DORMANT,
        toStage: LeadStage.DOCUMENTS_PENDING,
        lead: makeLead(LeadStage.DORMANT),
        actor: makeUser(RoleCode.RM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toContain('invalid_target_stage_from_dormant');
    });

    // FR-055: eligibility_requested → ready_for_handoff is now invalid (re-pointed to pending_approval).
    it('FR-055: eligibility_requested → ready_for_handoff is now invalid_transition', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.ELIGIBILITY_REQUESTED,
        toStage: LeadStage.READY_FOR_HANDOFF,
        lead: makeLead(LeadStage.ELIGIBILITY_REQUESTED),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toContain('invalid_transition');
    });

    // FR-055: RM cannot approve (missing approve_lead capability).
    it('FR-055: RM cannot move pending_approval → ready_for_handoff (role_not_permitted)', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.PENDING_APPROVAL,
        toStage: LeadStage.READY_FOR_HANDOFF,
        lead: makeLead(LeadStage.PENDING_APPROVAL),
        actor: makeUser(RoleCode.RM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toContain('role_not_permitted');
    });
  });

  // ── U03 analogue at guard level: guard passes for valid reason ───────────

  it('rejected → prior active stage with reason returns empty failed[]', async () => {
    const result = await service.evaluate({
      fromStage: LeadStage.REJECTED,
      toStage: LeadStage.CONTACTED,
      lead: makeLead(LeadStage.REJECTED),
      actor: makeUser(RoleCode.BM),
      reason: 'Customer changed mind',
      tx: fakeTx,
    });
    expect(result.failed).toHaveLength(0);
  });

  // ── BLOCKER 1: rejected → rejected is NOT permitted ─────────────────────

  describe('rejected → rejected is illegal (terminal-unless-reopened)', () => {
    it('rejected → rejected fails: invalid_source_stage guard', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.REJECTED,
        toStage: LeadStage.REJECTED,
        lead: makeLead(LeadStage.REJECTED),
        actor: makeUser(RoleCode.BM),
        reason: 'Still rejected',
        tx: fakeTx,
      });
      // REJECTED is not in ACTIVE_STAGES — the "any active → rejected" branch
      // fires the invalid_source_stage guard.
      expect(result.failed).toContain('invalid_source_stage');
    });

    it('rejected → rejected fails even with RM + reason', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.REJECTED,
        toStage: LeadStage.REJECTED,
        lead: makeLead(LeadStage.REJECTED),
        actor: makeUser(RoleCode.RM),
        reason: 'Re-rejecting',
        tx: fakeTx,
      });
      expect(result.failed.length).toBeGreaterThan(0);
    });
  });

  // ── BLOCKER 2: consent_present enforced on ready_for_handoff → handed_off ─

  describe('consent_present guard enforced against consent_status', () => {
    it('consent_status=captured passes consent_present', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.READY_FOR_HANDOFF,
        toStage: LeadStage.HANDED_OFF,
        lead: makeLead(LeadStage.READY_FOR_HANDOFF, { consent_status: 'captured', duplicate_status: 'none' }),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).not.toContain('consent_present');
    });

    it('consent_status=pending fails consent_present', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.READY_FOR_HANDOFF,
        toStage: LeadStage.HANDED_OFF,
        lead: makeLead(LeadStage.READY_FOR_HANDOFF, { consent_status: 'pending', duplicate_status: 'none' }),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toContain('consent_present');
    });

    it('consent_status=withdrawn fails consent_present', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.READY_FOR_HANDOFF,
        toStage: LeadStage.HANDED_OFF,
        lead: makeLead(LeadStage.READY_FOR_HANDOFF, { consent_status: 'withdrawn', duplicate_status: 'none' }),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toContain('consent_present');
    });

    it('consent_status=partial fails consent_present', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.READY_FOR_HANDOFF,
        toStage: LeadStage.HANDED_OFF,
        lead: makeLead(LeadStage.READY_FOR_HANDOFF, { consent_status: 'partial', duplicate_status: 'none' }),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toContain('consent_present');
    });
  });

  // ── BLOCKER 2: duplicate_clear enforced against duplicate_status ──────────

  describe('duplicate_clear guard enforced against duplicate_status', () => {
    it('duplicate_status=none passes duplicate_clear', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.READY_FOR_HANDOFF,
        toStage: LeadStage.HANDED_OFF,
        lead: makeLead(LeadStage.READY_FOR_HANDOFF, { consent_status: 'captured', duplicate_status: 'none' }),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).not.toContain('duplicate_clear');
    });

    it('duplicate_status=flagged fails duplicate_clear', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.READY_FOR_HANDOFF,
        toStage: LeadStage.HANDED_OFF,
        lead: makeLead(LeadStage.READY_FOR_HANDOFF, { consent_status: 'captured', duplicate_status: 'flagged' }),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).toContain('duplicate_clear');
    });

    it('duplicate_status=merged passes duplicate_clear', async () => {
      const result = await service.evaluate({
        fromStage: LeadStage.READY_FOR_HANDOFF,
        toStage: LeadStage.HANDED_OFF,
        lead: makeLead(LeadStage.READY_FOR_HANDOFF, { consent_status: 'captured', duplicate_status: 'merged' }),
        actor: makeUser(RoleCode.BM),
        reason: null,
        tx: fakeTx,
      });
      expect(result.failed).not.toContain('duplicate_clear');
    });
  });
});
