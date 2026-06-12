import {
  ConsentPurpose,
  ConsentState,
  ConsentStatus,
  ERROR_CODES,
  RoleCode,
  type ScopePredicate,
} from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { DbTransaction, UnitOfWork } from '../../core/db';
import type { OutboxService } from '../../core/outbox';
import type { LeadService } from '../capture/lead.service';
import { SYSTEM_ACTOR_ID } from '../capture/capture.constants';
import { REQUIRED_CONSENT_PURPOSES } from './consent-derivation';
import type {
  ConsentRecordRow,
  ConsentRepository,
  LeadConsentContext,
  NewConsentRecord,
} from './consent.repository';
import {
  ConsentService,
  leadInScope,
  type ConsentActorContext,
} from './consent.service';
import type { CaptureConsentDto } from './dto/capture-consent.dto';
import type { ResolvedCustomerLink } from './ports/customer-link.port';

/**
 * FR-110 unit + component tests (FR-110-tests.md). The full-HTTP+DB tier
 * (T01–T24 as supertest+Testcontainers assertions) is the DEFERRED integration
 * wave (manifest stage7.test_strategy); here each named scenario is exercised
 * at the service layer with the AbacGuard predicate mocked: T01–T03 happy
 * paths, T07–T12 error paths, T14–T18 list/filter/masking analogues, T19
 * customer path, T25–T28 derivation matrix, T29 append-only enforcement,
 * T30/T31 rollback propagation, T32–T34 audit/outbox effects. T04–T06/T22/T23
 * (Zod tier) live in consent.dto.spec.ts; T13/T20/T21/T24 guard-tier analogues
 * in consent.controller.spec.ts.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD = 'b0000000-0000-0000-0000-00000000000b';
const RM = 'a0000000-0000-0000-0000-0000000000a1';
const TX = { __tx: true } as unknown as DbTransaction;

function leadCtx(overrides: Partial<LeadConsentContext> = {}): LeadConsentContext {
  return {
    lead_id: LEAD,
    org_id: ORG,
    owner_id: RM,
    branch_id: 'branch-1',
    customer_profile_id: 'cp-1',
    partner_id: null,
    ...overrides,
  };
}

function actorCtx(overrides: Partial<ConsentActorContext> = {}): ConsentActorContext {
  return {
    userId: RM,
    orgId: ORG,
    role: RoleCode.RM,
    predicate: { type: 'own', userId: RM },
    requestMeta: { ip: '10.0.0.9', userAgent: 'jest' },
    ...overrides,
  };
}

function captureDto(overrides: Partial<CaptureConsentDto> = {}): CaptureConsentDto {
  return {
    purpose: ConsentPurpose.LEAD_CONTACT,
    state: ConsentState.GRANTED,
    notice_version: 'v1.0',
    consent_text_version: 'v1.0',
    channel: 'manual',
    actor: 'rm',
    ...overrides,
  };
}

function rowFromRecord(record: NewConsentRecord): ConsentRecordRow {
  return {
    consent_id: record.consent_id,
    org_id: record.org_id,
    lead_id: record.lead_id,
    customer_profile_id: record.customer_profile_id,
    purpose: record.purpose,
    data_category: record.data_category,
    state: record.state,
    channel: record.channel,
    language: record.language,
    notice_version: record.notice_version,
    consent_text_version: record.consent_text_version,
    actor: record.actor,
    ip_device: record.ip_device,
    expires_at: record.expires_at,
    superseded_by: null,
    created_at: new Date('2026-06-12T10:00:00Z'),
    updated_at: new Date('2026-06-12T10:00:00Z'),
  };
}

interface Harness {
  service: ConsentService;
  repo: {
    listForLead: jest.Mock;
    countForLead: jest.Mock;
    findLatestPerPurpose: jest.Mock;
    findLatestOpenGrant: jest.Mock;
    hasPriorGrant: jest.Mock;
    insert: jest.Mock;
    markSuperseded: jest.Mock;
    findLeadConsentContext: jest.Mock;
  };
  leads: { setConsentStatus: jest.Mock };
  audit: { append: jest.Mock };
  outbox: { emit: jest.Mock };
  uowRun: jest.Mock;
}

function makeHarness(): Harness {
  const repo = {
    listForLead: jest.fn().mockResolvedValue([]),
    countForLead: jest.fn().mockResolvedValue(0),
    findLatestPerPurpose: jest.fn().mockResolvedValue([]),
    findLatestOpenGrant: jest.fn().mockResolvedValue(undefined),
    hasPriorGrant: jest.fn().mockResolvedValue(false),
    insert: jest.fn(async (record: NewConsentRecord) => rowFromRecord(record)),
    markSuperseded: jest.fn().mockResolvedValue(undefined),
    findLeadConsentContext: jest.fn().mockResolvedValue(leadCtx()),
  };
  const leads = { setConsentStatus: jest.fn().mockResolvedValue(undefined) };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const outbox = { emit: jest.fn().mockResolvedValue(undefined) };
  const uowRun = jest.fn(async (fn: (tx: DbTransaction) => Promise<unknown>) => fn(TX));

  const service = new ConsentService(
    { run: uowRun } as unknown as UnitOfWork,
    repo as unknown as ConsentRepository,
    leads as unknown as LeadService,
    audit as unknown as AuditAppender,
    outbox as unknown as OutboxService,
  );
  return { service, repo, leads, audit, outbox, uowRun };
}

// ────────────────────────────────────────────────── staff capture (T01–T03) ──

describe('ConsentService.capture', () => {
  it('T01: appends a granted row (actor=rm), re-derives consent_status in the same tx and returns it', async () => {
    const h = makeHarness();
    h.repo.findLatestPerPurpose.mockResolvedValue([
      { purpose: ConsentPurpose.LEAD_CONTACT, state: ConsentState.GRANTED },
    ]);

    const result = await h.service.capture(LEAD, captureDto(), actorCtx());

    expect(h.repo.insert).toHaveBeenCalledTimes(1);
    const inserted = h.repo.insert.mock.calls[0]?.[0] as NewConsentRecord;
    expect(inserted).toMatchObject({
      org_id: ORG,
      lead_id: LEAD,
      customer_profile_id: 'cp-1',
      purpose: ConsentPurpose.LEAD_CONTACT,
      state: ConsentState.GRANTED,
      actor: 'rm',
      channel: 'manual',
      notice_version: 'v1.0',
      consent_text_version: 'v1.0',
    });
    expect(h.repo.insert.mock.calls[0]?.[1]).toBe(TX);
    // leads.consent_status re-derived through the sole writer, same tx.
    expect(h.leads.setConsentStatus).toHaveBeenCalledWith(LEAD, ConsentStatus.PARTIAL, ORG, TX);
    expect(result).toMatchObject({
      consent_id: inserted.consent_id,
      lead_id: LEAD,
      purpose: ConsentPurpose.LEAD_CONTACT,
      state: ConsentState.GRANTED,
      derived_consent_status: ConsentStatus.PARTIAL,
    });
    expect(result.created_at).toBeInstanceOf(Date);
    expect(h.uowRun).toHaveBeenCalledTimes(1);
  });

  it('T02: a withdrawal appends a NEW row (prior grant required), derives withdrawn and emits CONSENT_WITHDRAWN in the same tx', async () => {
    const h = makeHarness();
    h.repo.hasPriorGrant.mockResolvedValue(true);
    h.repo.findLatestPerPurpose.mockResolvedValue([
      { purpose: ConsentPurpose.LEAD_CONTACT, state: ConsentState.WITHDRAWN },
    ]);

    const result = await h.service.capture(
      LEAD,
      captureDto({ state: ConsentState.WITHDRAWN }),
      actorCtx(),
    );

    expect(h.repo.insert).toHaveBeenCalledTimes(1);
    expect(h.repo.insert.mock.calls[0]?.[0]).toMatchObject({ state: ConsentState.WITHDRAWN });
    expect(h.leads.setConsentStatus).toHaveBeenCalledWith(LEAD, ConsentStatus.WITHDRAWN, ORG, TX);
    expect(h.outbox.emit).toHaveBeenCalledTimes(1);
    expect(h.outbox.emit).toHaveBeenCalledWith(
      {
        event_code: 'CONSENT_WITHDRAWN',
        aggregate_type: 'leads',
        aggregate_id: LEAD,
        payload: { lead_id: LEAD, purpose: ConsentPurpose.LEAD_CONTACT },
      },
      TX,
    );
    expect(result.derived_consent_status).toBe(ConsentStatus.WITHDRAWN);
    // Append-only: no update/delete of existing rows on a withdrawal.
    expect(h.repo.markSuperseded).not.toHaveBeenCalled();
  });

  it('T03: a repeat grant marks the prior granted row superseded_by the NEW consent_id (pointer only, same tx)', async () => {
    const h = makeHarness();
    h.repo.findLatestOpenGrant.mockResolvedValue({ consent_id: 'prior-1' });

    await h.service.capture(LEAD, captureDto({ purpose: ConsentPurpose.KYC }), actorCtx());

    const newId = (h.repo.insert.mock.calls[0]?.[0] as NewConsentRecord).consent_id;
    expect(h.repo.findLatestOpenGrant).toHaveBeenCalledWith(LEAD, ORG, ConsentPurpose.KYC, TX);
    expect(h.repo.markSuperseded).toHaveBeenCalledTimes(1);
    expect(h.repo.markSuperseded).toHaveBeenCalledWith('prior-1', newId, ORG, TX);
    // The new row itself is never born superseded.
    expect(h.repo.insert.mock.calls[0]?.[0]).toMatchObject({ purpose: ConsentPurpose.KYC });
  });

  it('a denied capture supersedes nothing and emits no event (denied ≠ withdrawn)', async () => {
    const h = makeHarness();
    await h.service.capture(LEAD, captureDto({ state: ConsentState.DENIED }), actorCtx());
    expect(h.repo.findLatestOpenGrant).not.toHaveBeenCalled();
    expect(h.repo.markSuperseded).not.toHaveBeenCalled();
    expect(h.outbox.emit).not.toHaveBeenCalled();
  });

  // ── error paths (T07–T12) ──

  it('T07: state=expired → VALIDATION_ERROR (field state, message names "expired"); nothing written', async () => {
    const h = makeHarness();
    await expect(
      h.service.capture(LEAD, captureDto({ state: ConsentState.EXPIRED }), actorCtx()),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: [expect.objectContaining({ field: 'state', issue: expect.stringContaining('expired') })],
    });
    expect(h.repo.insert).not.toHaveBeenCalled();
    expect(h.uowRun).not.toHaveBeenCalled();
  });

  it('T08: state=superseded → VALIDATION_ERROR (field state); nothing written', async () => {
    const h = makeHarness();
    await expect(
      h.service.capture(LEAD, captureDto({ state: ConsentState.SUPERSEDED }), actorCtx()),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: [expect.objectContaining({ field: 'state' })],
    });
    expect(h.repo.insert).not.toHaveBeenCalled();
  });

  it('T09: withdrawing a never-granted purpose → VALIDATION_ERROR "Cannot withdraw consent that was never granted."', async () => {
    const h = makeHarness();
    h.repo.hasPriorGrant.mockResolvedValue(false);
    await expect(
      h.service.capture(
        LEAD,
        captureDto({ purpose: ConsentPurpose.LOS_HANDOFF, state: ConsentState.WITHDRAWN }),
        actorCtx(),
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: [
        expect.objectContaining({
          field: 'state',
          issue: 'Cannot withdraw consent that was never granted.',
        }),
      ],
    });
    expect(h.repo.hasPriorGrant).toHaveBeenCalledWith(LEAD, ORG, ConsentPurpose.LOS_HANDOFF);
    expect(h.repo.insert).not.toHaveBeenCalled();
    expect(h.outbox.emit).not.toHaveBeenCalled();
  });

  it("T10: RM posting for another RM's lead → FORBIDDEN; no row inserted", async () => {
    const h = makeHarness();
    h.repo.findLeadConsentContext.mockResolvedValue(leadCtx({ owner_id: 'rm-other' }));
    await expect(h.service.capture(LEAD, captureDto(), actorCtx())).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
    expect(h.repo.insert).not.toHaveBeenCalled();
  });

  it("T11: PARTNER posting for another partner's lead → FORBIDDEN; no row inserted", async () => {
    const h = makeHarness();
    h.repo.findLeadConsentContext.mockResolvedValue(leadCtx({ partner_id: 'partner-B' }));
    await expect(
      h.service.capture(
        LEAD,
        captureDto(),
        actorCtx({
          role: RoleCode.PARTNER,
          predicate: { type: 'partner', partnerId: 'partner-A' },
        }),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    expect(h.repo.insert).not.toHaveBeenCalled();
  });

  it('T12: unknown lead_id → NOT_FOUND; no row inserted', async () => {
    const h = makeHarness();
    h.repo.findLeadConsentContext.mockResolvedValue(undefined);
    await expect(h.service.capture(LEAD, captureDto(), actorCtx())).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
    expect(h.repo.insert).not.toHaveBeenCalled();
  });

  // ── transaction rollback propagation (T30/T31) ──

  it('T30: when LeadService.setConsentStatus throws, the error propagates out of the UnitOfWork (tx rolls back) and no event is emitted', async () => {
    const h = makeHarness();
    const boom = new Error('setConsentStatus failed');
    h.leads.setConsentStatus.mockRejectedValue(boom);

    await expect(h.service.capture(LEAD, captureDto(), actorCtx())).rejects.toBe(boom);

    // The insert ran INSIDE the same tx the failure aborts — UnitOfWork.run
    // (core/db, FR-platform-tested) rolls the whole tx back; nothing is
    // swallowed and the audit/outbox steps after the failure never run.
    expect(h.repo.insert).toHaveBeenCalledWith(expect.anything(), TX);
    expect(h.audit.append).not.toHaveBeenCalled();
    expect(h.outbox.emit).not.toHaveBeenCalled();
  });

  it('T31: when OutboxService.emit throws on a withdrawal, the error propagates (whole tx rolls back)', async () => {
    const h = makeHarness();
    h.repo.hasPriorGrant.mockResolvedValue(true);
    const boom = new Error('outbox unavailable');
    h.outbox.emit.mockRejectedValue(boom);

    await expect(
      h.service.capture(LEAD, captureDto({ state: ConsentState.WITHDRAWN }), actorCtx()),
    ).rejects.toBe(boom);
    expect(h.outbox.emit).toHaveBeenCalledWith(expect.anything(), TX);
  });

  // ── audit + outbox effects (T32–T34) ──

  it('T32: audit intent appended exactly once per capture — consent_grant on consent_records, PII-free detail {purpose, state}', async () => {
    const h = makeHarness();
    await h.service.capture(LEAD, captureDto(), actorCtx());

    expect(h.audit.append).toHaveBeenCalledTimes(1);
    const [entry, tx] = h.audit.append.mock.calls[0] as [Record<string, unknown>, DbTransaction];
    const newId = (h.repo.insert.mock.calls[0]?.[0] as NewConsentRecord).consent_id;
    expect(entry).toMatchObject({
      action: 'consent_grant',
      entity_type: 'consent_records',
      entity_id: newId,
      actor_id: RM,
      org_id: ORG,
      lead_id: LEAD,
    });
    // detail carries the purpose + state ONLY — no PII fields.
    expect(entry['detail']).toEqual({
      purpose: ConsentPurpose.LEAD_CONTACT,
      state: ConsentState.GRANTED,
    });
    expect(tx).toBe(TX);
  });

  it('T32 (withdrawal variant): audit action is consent_withdraw', async () => {
    const h = makeHarness();
    h.repo.hasPriorGrant.mockResolvedValue(true);
    await h.service.capture(LEAD, captureDto({ state: ConsentState.WITHDRAWN }), actorCtx());
    expect(h.audit.append).toHaveBeenCalledTimes(1);
    expect(h.audit.append.mock.calls[0]?.[0]).toMatchObject({ action: 'consent_withdraw' });
  });

  it('T33: a granted capture emits NO outbox event (audit intent only)', async () => {
    const h = makeHarness();
    await h.service.capture(LEAD, captureDto(), actorCtx());
    expect(h.outbox.emit).not.toHaveBeenCalled();
    expect(h.audit.append).toHaveBeenCalledTimes(1);
  });

  it('T34: a withdrawal emits exactly one CONSENT_WITHDRAWN with payload {lead_id, purpose} (no PII)', async () => {
    const h = makeHarness();
    h.repo.hasPriorGrant.mockResolvedValue(true);
    await h.service.capture(LEAD, captureDto({ state: ConsentState.WITHDRAWN }), actorCtx());

    expect(h.outbox.emit).toHaveBeenCalledTimes(1);
    const event = h.outbox.emit.mock.calls[0]?.[0] as { event_code: string; payload: Record<string, unknown> };
    expect(event.event_code).toBe('CONSENT_WITHDRAWN');
    expect(event.payload).toEqual({ lead_id: LEAD, purpose: ConsentPurpose.LEAD_CONTACT });
  });
});

// ───────────────────────────────────────────── customer self-service (T19) ──

describe('ConsentService.captureFromCustomer', () => {
  const link: ResolvedCustomerLink = {
    leadId: LEAD,
    customerProfileId: 'cp-9',
    orgId: ORG,
    channel: 'website',
  };

  it('T19: appends actor=customer with the link channel and header-derived ip_device; re-derives consent_status', async () => {
    const h = makeHarness();
    const result = await h.service.captureFromCustomer(
      link,
      {
        purpose: ConsentPurpose.LEAD_CONTACT,
        state: ConsentState.GRANTED,
        notice_version: 'v1.0',
        consent_text_version: 'v1.0',
      },
      { ip: '49.32.1.7', userAgent: 'iPhone Safari' },
    );

    const inserted = h.repo.insert.mock.calls[0]?.[0] as NewConsentRecord;
    expect(inserted).toMatchObject({
      lead_id: LEAD,
      org_id: ORG,
      customer_profile_id: 'cp-9', // from the resolved link
      actor: 'customer',
      channel: 'website',
      ip_device: { ip: '49.32.1.7', device: 'iPhone Safari' },
    });
    expect(h.leads.setConsentStatus).toHaveBeenCalledWith(LEAD, expect.anything(), ORG, TX);
    // Public path: the audit actor is the reserved system actor (users FK).
    expect(h.audit.append.mock.calls[0]?.[0]).toMatchObject({ actor_id: SYSTEM_ACTOR_ID });
    // Endpoint-3 response shape: no lead_id / derived status leak to the customer.
    expect(result).toEqual({
      consent_id: inserted.consent_id,
      purpose: ConsentPurpose.LEAD_CONTACT,
      state: ConsentState.GRANTED,
      created_at: expect.any(Date),
    });
  });

  it('falls back to the lead customer_profile_id when the link carries none', async () => {
    const h = makeHarness();
    await h.service.captureFromCustomer(
      { ...link, customerProfileId: null },
      {
        purpose: ConsentPurpose.KYC,
        state: ConsentState.DENIED,
        notice_version: 'v1.0',
        consent_text_version: 'v1.0',
      },
      {},
    );
    const inserted = h.repo.insert.mock.calls[0]?.[0] as NewConsentRecord;
    expect(inserted.customer_profile_id).toBe('cp-1');
    expect(inserted.ip_device).toBeNull();
  });

  it('returns NOT_FOUND when the link-bound lead no longer exists (existence hidden)', async () => {
    const h = makeHarness();
    h.repo.findLeadConsentContext.mockResolvedValue(undefined);
    await expect(
      h.service.captureFromCustomer(
        link,
        {
          purpose: ConsentPurpose.LEAD_CONTACT,
          state: ConsentState.GRANTED,
          notice_version: 'v1.0',
          consent_text_version: 'v1.0',
        },
        {},
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    expect(h.repo.insert).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────── list + masking (T14–T18, T17) ──

describe('ConsentService.listForLead', () => {
  function listedRow(overrides: Partial<ConsentRecordRow> = {}): ConsentRecordRow {
    const base = rowFromRecord({
      consent_id: 'c-1',
      org_id: ORG,
      lead_id: LEAD,
      customer_profile_id: 'cp-1',
      purpose: ConsentPurpose.LEAD_CONTACT,
      data_category: null,
      state: ConsentState.GRANTED,
      channel: 'manual',
      language: null,
      notice_version: 'v1.0',
      consent_text_version: 'v1.0',
      actor: 'rm',
      ip_device: { ip: '10.0.0.1', device: 'iPhone 14' },
      expires_at: null,
    });
    return { ...base, ...overrides };
  }

  it('T14: returns the requested page with pagination meta {page, limit, total}', async () => {
    const h = makeHarness();
    h.repo.listForLead.mockResolvedValue([listedRow()]);
    h.repo.countForLead.mockResolvedValue(30);

    const result = await h.service.listForLead(
      LEAD,
      { page: 1, limit: 25 },
      actorCtx(),
    );

    expect(h.repo.listForLead).toHaveBeenCalledWith(
      LEAD,
      ORG,
      { purpose: undefined, state: undefined },
      1,
      25,
    );
    expect(result.pagination).toEqual({ page: 1, limit: 25, total: 30 });
    expect(result.data).toHaveLength(1);
  });

  it('T15/T16: purpose and state filters are passed through to the repository (same WHERE for page + count)', async () => {
    const h = makeHarness();
    await h.service.listForLead(
      LEAD,
      { page: 2, limit: 10, purpose: ConsentPurpose.KYC, state: ConsentState.WITHDRAWN },
      actorCtx(),
    );
    const filters = { purpose: ConsentPurpose.KYC, state: ConsentState.WITHDRAWN };
    expect(h.repo.listForLead).toHaveBeenCalledWith(LEAD, ORG, filters, 2, 10);
    expect(h.repo.countForLead).toHaveBeenCalledWith(LEAD, ORG, filters);
  });

  it('T17: out-of-scope RM read → FORBIDDEN', async () => {
    const h = makeHarness();
    h.repo.findLeadConsentContext.mockResolvedValue(leadCtx({ owner_id: 'rm-other' }));
    await expect(
      h.service.listForLead(LEAD, { page: 1, limit: 25 }, actorCtx()),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    expect(h.repo.listForLead).not.toHaveBeenCalled();
  });

  it('T18: ip_device is masked (null) for RM and visible for DPO and ADMIN', async () => {
    const h = makeHarness();
    h.repo.listForLead.mockResolvedValue([listedRow()]);
    h.repo.countForLead.mockResolvedValue(1);

    const asRm = await h.service.listForLead(LEAD, { page: 1, limit: 25 }, actorCtx());
    expect(asRm.data[0]?.ip_device).toBeNull();

    const asDpo = await h.service.listForLead(
      LEAD,
      { page: 1, limit: 25 },
      actorCtx({ role: RoleCode.DPO, predicate: { type: 'all', orgId: ORG } }),
    );
    expect(asDpo.data[0]?.ip_device).toEqual({ ip: '10.0.0.1', device: 'iPhone 14' });

    const asAdmin = await h.service.listForLead(
      LEAD,
      { page: 1, limit: 25 },
      actorCtx({ role: RoleCode.ADMIN, predicate: { type: 'all', orgId: ORG } }),
    );
    expect(asAdmin.data[0]?.ip_device).toEqual({ ip: '10.0.0.1', device: 'iPhone 14' });
  });

  it('exposes the LLD §Endpoint-1 wire fields (superseded_by chain included, updated_at excluded)', async () => {
    const h = makeHarness();
    h.repo.listForLead.mockResolvedValue([listedRow({ superseded_by: 'c-0' })]);
    h.repo.countForLead.mockResolvedValue(1);
    const result = await h.service.listForLead(LEAD, { page: 1, limit: 25 }, actorCtx());
    expect(Object.keys(result.data[0] ?? {}).sort()).toEqual(
      [
        'consent_id',
        'lead_id',
        'customer_profile_id',
        'purpose',
        'data_category',
        'state',
        'channel',
        'language',
        'notice_version',
        'consent_text_version',
        'actor',
        'ip_device',
        'expires_at',
        'superseded_by',
        'created_at',
      ].sort(),
    );
    expect(result.data[0]?.superseded_by).toBe('c-0');
  });
});

// ───────────────────────────────────────────── derivation matrix (T25–T28) ──

describe('ConsentService.deriveConsentStatus', () => {
  const service = makeHarness().service;
  const granted = (purpose: ConsentPurpose) => ({ purpose, state: ConsentState.GRANTED });

  it('T25: returns captured when all required purposes are granted', () => {
    expect(service.deriveConsentStatus(REQUIRED_CONSENT_PURPOSES.map(granted))).toBe(
      ConsentStatus.CAPTURED,
    );
  });

  it('T26: returns partial when only some required purposes are granted', () => {
    expect(
      service.deriveConsentStatus([
        granted(ConsentPurpose.LEAD_CONTACT),
        granted(ConsentPurpose.KYC),
      ]),
    ).toBe(ConsentStatus.PARTIAL);
  });

  it('T27: returns withdrawn when ANY purpose is withdrawn (even with the rest granted)', () => {
    expect(
      service.deriveConsentStatus([
        { purpose: ConsentPurpose.LEAD_CONTACT, state: ConsentState.WITHDRAWN },
        granted(ConsentPurpose.PRODUCT_ELIGIBILITY),
        granted(ConsentPurpose.KYC),
        granted(ConsentPurpose.DOCUMENT_PROCESSING),
        granted(ConsentPurpose.LOS_HANDOFF),
      ]),
    ).toBe(ConsentStatus.WITHDRAWN);
  });

  it('T28: returns pending when the map is empty or nothing is granted', () => {
    expect(service.deriveConsentStatus([])).toBe(ConsentStatus.PENDING);
    expect(
      service.deriveConsentStatus([
        { purpose: ConsentPurpose.LEAD_CONTACT, state: ConsentState.DENIED },
        { purpose: ConsentPurpose.KYC, state: ConsentState.DENIED },
      ]),
    ).toBe(ConsentStatus.PENDING);
  });

  it('pins the canonical required-purpose set (FR-110 LLD §Transaction boundary)', () => {
    expect(REQUIRED_CONSENT_PURPOSES).toEqual([
      ConsentPurpose.LEAD_CONTACT,
      ConsentPurpose.PRODUCT_ELIGIBILITY,
      ConsentPurpose.KYC,
      ConsentPurpose.DOCUMENT_PROCESSING,
      ConsentPurpose.LOS_HANDOFF,
    ]);
  });
});

// ─────────────────────────────────────────── append-only enforcement (T29) ──

describe('ConsentService append-only enforcement', () => {
  it('T29: updateConsent throws FORBIDDEN at the service layer — no query builder is ever reached', () => {
    const h = makeHarness();
    let caught: unknown;
    try {
      h.service.updateConsent();
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    expect(h.repo.insert).not.toHaveBeenCalled();
    expect(h.repo.markSuperseded).not.toHaveBeenCalled();
    expect(h.uowRun).not.toHaveBeenCalled();
  });

  it('T29/INV-02: deleteConsent throws FORBIDDEN — the ledger is never deleted from', () => {
    const h = makeHarness();
    let caught: unknown;
    try {
      h.service.deleteConsent();
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    expect(h.uowRun).not.toHaveBeenCalled();
  });

  it('the repository exposes no generic UPDATE/DELETE surface for consent_records', () => {
    const h = makeHarness();
    const surface = Object.keys(h.repo);
    expect(surface).not.toContain('update');
    expect(surface).not.toContain('delete');
    expect(surface).not.toContain('updateConsent');
    expect(surface).not.toContain('deleteConsent');
  });
});

// ─────────────────────────────────────────────── scope predicate unit table ──

describe('leadInScope (FR-002 predicate → lead row)', () => {
  const lead = leadCtx({ owner_id: 'rm-1', branch_id: 'br-1', partner_id: 'p-1' });

  it.each<[string, ScopePredicate | undefined, boolean]>([
    ['own / owner match', { type: 'own', userId: 'rm-1' }, true],
    ['own / other owner', { type: 'own', userId: 'rm-2' }, false],
    ['team / member', { type: 'team', userIds: ['rm-1', 'rm-9'] }, true],
    ['team / non-member', { type: 'team', userIds: ['rm-9'] }, false],
    ['branch / match', { type: 'branch', branchId: 'br-1' }, true],
    ['branch / other', { type: 'branch', branchId: 'br-2' }, false],
    ['region / contains branch', { type: 'region', branchIds: ['br-1', 'br-2'] }, true],
    ['region / other region', { type: 'region', branchIds: ['br-9'] }, false],
    ['all / same org', { type: 'all', orgId: ORG }, true],
    ['masked (DPO) / same org', { type: 'masked', orgId: ORG }, true],
    ['partner / own submission', { type: 'partner', partnerId: 'p-1' }, true],
    ['partner / cross-partner', { type: 'partner', partnerId: 'p-2' }, false],
    ['customer_token / bound lead', { type: 'customer_token', leadId: LEAD }, true],
    ['customer_token / other lead', { type: 'customer_token', leadId: 'other' }, false],
    ['missing predicate (deny-by-default)', undefined, false],
  ])('%s → %s', (_label, predicate, expected) => {
    expect(leadInScope(lead, predicate)).toBe(expected);
  });

  it('unowned lead is out of scope for own/team predicates', () => {
    const pool = leadCtx({ owner_id: null });
    expect(leadInScope(pool, { type: 'own', userId: 'rm-1' })).toBe(false);
    expect(leadInScope(pool, { type: 'team', userIds: ['rm-1'] })).toBe(false);
  });
});
