import 'reflect-metadata';

import {
  CommChannel,
  ConsentPurpose,
  CreationChannel,
  DataScope,
  ERROR_CODES,
  RoleCode,
  SubjectType,
} from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import { REQUIRES_KEY } from '../../core/auth/requires.decorator';
import type { RequestWithUser } from '../../core/auth/auth-user';
import { PreferenceController } from './preference.controller';
import { CustomerPreferenceController } from './customer-preference.controller';
import type { PreferenceService } from './preference.service';
import type { CustomerLinkPort, ResolvedCustomerLink } from '../compliance/ports/customer-link.port';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUBJECT_REF = '00000000-0000-0000-0001-000000000001';
const USER_ID = '00000000-0000-0000-0003-000000000001';
const OTHER_USER_ID = '00000000-0000-0000-0003-000000000002';
const PREF_ID = '00000000-0000-0000-0004-000000000001';

const BM_USER: AuthUser = {
  userId: USER_ID,
  orgId: ORG_ID,
  role: RoleCode.BM,
  scope: DataScope.B,
  jti: 'jti-bm',
};

function makePrefRow(channel: CommChannel, purpose: ConsentPurpose, optedIn: boolean) {
  return {
    notification_preference_id: PREF_ID,
    channel,
    purpose,
    opted_in: optedIn,
    updated_at: new Date('2026-06-10T09:00:00.000Z'),
  };
}

function fakeService(opts: {
  upsertResult?: ReturnType<typeof makePrefRow>[];
  warnings?: Array<{ field: string; message: string }>;
} = {}): PreferenceService {
  const rows = opts.upsertResult ?? [makePrefRow(CommChannel.SMS, ConsentPurpose.MARKETING, false)];
  const warnings = opts.warnings ?? [];
  return {
    upsertBatch: jest.fn().mockResolvedValue({
      result: {
        subject_type: SubjectType.CUSTOMER,
        subject_ref: SUBJECT_REF,
        preferences: rows,
      },
      warnings,
    }),
    getBySubject: jest.fn().mockResolvedValue({
      subject_type: SubjectType.CUSTOMER,
      subject_ref: SUBJECT_REF,
      preferences: rows,
    }),
    isAllowed: jest.fn(),
  } as unknown as PreferenceService;
}

function fakeLinks(link: ResolvedCustomerLink | null): CustomerLinkPort {
  return {
    resolveForConsent: jest.fn().mockResolvedValue(link),
  } as unknown as CustomerLinkPort;
}

// ── PreferenceController (internal staff path) ────────────────────────────────

describe('PreferenceController (FR-103)', () => {

  // ── BLOCKER-1: response envelope shape ────────────────────────────────────────

  describe('PUT /preferences — envelope shape', () => {
    it('returns { data, meta: { correlation_id, warnings }, error: null } when warnings present', async () => {
      const service = fakeService({
        warnings: [{ field: 'preferences[0]', message: 'Opting out of KYC/document reminders may delay your application processing.' }],
      });
      const controller = new PreferenceController(service);

      const result = await controller.upsert(
        {
          subject_type: SubjectType.CUSTOMER,
          subject_ref: SUBJECT_REF,
          preferences: [{ channel: CommChannel.SMS, purpose: ConsentPurpose.KYC, opted_in: false }],
        },
        BM_USER,
      );

      // Must be a well-formed envelope so isEnvelope() passes — no double-wrap.
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
      expect(result).toHaveProperty('error', null);
      expect(result.meta.warnings).toHaveLength(1);
      expect(result.meta.warnings![0].field).toBe('preferences[0]');
    });

    it('returns { data, meta: { correlation_id }, error: null } when no warnings', async () => {
      const service = fakeService({ warnings: [] });
      const controller = new PreferenceController(service);

      const result = await controller.upsert(
        {
          subject_type: SubjectType.CUSTOMER,
          subject_ref: SUBJECT_REF,
          preferences: [{ channel: CommChannel.WHATSAPP, purpose: ConsentPurpose.MARKETING, opted_in: false }],
        },
        BM_USER,
      );

      expect(result).toHaveProperty('error', null);
      expect(result.meta.warnings).toBeUndefined();
    });
  });

  describe('GET /preferences — envelope shape', () => {
    it('returns a well-formed envelope', async () => {
      const service = fakeService();
      const controller = new PreferenceController(service);

      const result = await controller.get(
        { subject_type: SubjectType.CUSTOMER, subject_ref: SUBJECT_REF },
        BM_USER,
      );

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
      expect(result).toHaveProperty('error', null);
    });

    it('throws INTERNAL_ERROR when user has no orgId', async () => {
      const service = fakeService();
      const controller = new PreferenceController(service);

      const noOrgUser = { ...BM_USER, orgId: undefined as unknown as string };

      await expect(
        controller.get(
          { subject_type: SubjectType.CUSTOMER, subject_ref: SUBJECT_REF },
          noOrgUser,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.INTERNAL_ERROR });
    });
  });

  // ── BLOCKER-2: scope resolver populates ownerId ───────────────────────────────

  describe('PUT @Requires scope resolver (BLOCKER-2)', () => {
    it('scope resolver returns ownerId = subject_ref from body for O-scope check', () => {
      // Read the metadata the decorator set on the PUT handler.
      const meta = Reflect.getMetadata(REQUIRES_KEY, PreferenceController.prototype.upsert);
      expect(meta).toBeDefined();
      expect(meta.scopeResolver).toBeDefined();

      // Simulate a request whose body contains subject_ref.
      const fakeReq = {
        headers: {},
        body: { subject_ref: SUBJECT_REF, subject_type: SubjectType.CUSTOMER },
      } as unknown as RequestWithUser;

      const resource = meta.scopeResolver(fakeReq);
      expect(resource.resourceType).toBe('notification_preferences');
      expect(resource.ownerId).toBe(SUBJECT_REF);
    });

    it('scope resolver returns ownerId = undefined when body is absent', () => {
      const meta = Reflect.getMetadata(REQUIRES_KEY, PreferenceController.prototype.upsert);
      const fakeReq = { headers: {} } as unknown as RequestWithUser;

      const resource = meta.scopeResolver(fakeReq);
      expect(resource.ownerId).toBeUndefined();
    });
  });

  describe('GET @Requires scope resolver (MINOR-5)', () => {
    it('scope resolver returns ownerId = subject_ref from query for O-scope check', () => {
      const meta = Reflect.getMetadata(REQUIRES_KEY, PreferenceController.prototype.get);
      expect(meta).toBeDefined();
      expect(meta.scopeResolver).toBeDefined();

      const fakeReq = {
        headers: {},
        query: { subject_ref: SUBJECT_REF, subject_type: SubjectType.CUSTOMER },
      } as unknown as RequestWithUser;

      const resource = meta.scopeResolver(fakeReq);
      expect(resource.resourceType).toBe('notification_preferences');
      expect(resource.ownerId).toBe(SUBJECT_REF);
    });

    it('scope resolver — RM with different userId than subject_ref would be denied at guard', () => {
      // Verifies that the resolver correctly sets ownerId to subject_ref,
      // so EntitlementService O-scope check (ownerId !== userId) fires for RM.
      const meta = Reflect.getMetadata(REQUIRES_KEY, PreferenceController.prototype.upsert);
      const fakeReq = {
        headers: {},
        body: { subject_ref: OTHER_USER_ID, subject_type: SubjectType.USER },
      } as unknown as RequestWithUser;

      const resource = meta.scopeResolver(fakeReq);
      // RM_USER.userId = USER_ID; resource.ownerId = OTHER_USER_ID → guard denies.
      expect(resource.ownerId).toBe(OTHER_USER_ID);
    });
  });
});

// ── CustomerPreferenceController (customer link path) ─────────────────────────

describe('CustomerPreferenceController (FR-103)', () => {
  const CUSTOMER_PROFILE_ID = '00000000-0000-0000-0002-000000000001';
  const TOKEN = 'tok_abc123';

  function makeLink(overrides: Partial<ResolvedCustomerLink> = {}): ResolvedCustomerLink {
    return {
      leadId: '00000000-0000-0000-0005-000000000001',
      orgId: ORG_ID,
      customerProfileId: CUSTOMER_PROFILE_ID,
      channel: CreationChannel.WEBSITE,
      ...overrides,
    };
  }

  // ── BLOCKER-1: envelope shape ────────────────────────────────────────────────

  describe('PUT /c/:token/preferences — envelope shape', () => {
    it('returns a well-formed envelope with warnings in meta', async () => {
      const service = fakeService({
        warnings: [{ field: 'preferences[0]', message: 'Opting out of KYC/document reminders may delay your application processing.' }],
      });
      const links = fakeLinks(makeLink());
      const controller = new CustomerPreferenceController(service, links);

      const result = await controller.upsert(
        { token: TOKEN },
        {
          subject_type: SubjectType.CUSTOMER,
          subject_ref: CUSTOMER_PROFILE_ID,
          preferences: [{ channel: CommChannel.SMS, purpose: ConsentPurpose.KYC, opted_in: false }],
        },
      );

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
      expect(result).toHaveProperty('error', null);
      expect(result.meta.warnings).toHaveLength(1);
    });

    it('returns envelope with no warnings key when warnings array is empty', async () => {
      const service = fakeService({ warnings: [] });
      const links = fakeLinks(makeLink());
      const controller = new CustomerPreferenceController(service, links);

      const result = await controller.upsert(
        { token: TOKEN },
        {
          subject_type: SubjectType.CUSTOMER,
          subject_ref: CUSTOMER_PROFILE_ID,
          preferences: [{ channel: CommChannel.WHATSAPP, purpose: ConsentPurpose.MARKETING, opted_in: false }],
        },
      );

      expect(result).toHaveProperty('error', null);
      expect(result.meta.warnings).toBeUndefined();
    });
  });

  // ── MAJOR-3: null customerProfileId → FORBIDDEN ───────────────────────────────

  describe('PUT /c/:token/preferences — null customerProfileId (MAJOR-3)', () => {
    it('throws FORBIDDEN when customerProfileId is null', async () => {
      const service = fakeService();
      const links = fakeLinks(makeLink({ customerProfileId: null }));
      const controller = new CustomerPreferenceController(service, links);

      await expect(
        controller.upsert(
          { token: TOKEN },
          {
            subject_type: SubjectType.CUSTOMER,
            subject_ref: CUSTOMER_PROFILE_ID, // any ref
            preferences: [{ channel: CommChannel.SMS, purpose: ConsentPurpose.MARKETING, opted_in: false }],
          },
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });

      // Service must NOT be called.
      expect(service.upsertBatch).not.toHaveBeenCalled();
    });

    it('throws FORBIDDEN when subject_type is not customer', async () => {
      const service = fakeService();
      const links = fakeLinks(makeLink());
      const controller = new CustomerPreferenceController(service, links);

      await expect(
        controller.upsert(
          { token: TOKEN },
          {
            subject_type: SubjectType.USER, // wrong type
            subject_ref: CUSTOMER_PROFILE_ID,
            preferences: [{ channel: CommChannel.SMS, purpose: ConsentPurpose.MARKETING, opted_in: false }],
          },
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    });

    it('throws FORBIDDEN when subject_ref mismatches customerProfileId', async () => {
      const service = fakeService();
      const links = fakeLinks(makeLink());
      const controller = new CustomerPreferenceController(service, links);

      await expect(
        controller.upsert(
          { token: TOKEN },
          {
            subject_type: SubjectType.CUSTOMER,
            subject_ref: '00000000-0000-0000-0099-000000000099', // different UUID
            preferences: [{ channel: CommChannel.SMS, purpose: ConsentPurpose.MARKETING, opted_in: false }],
          },
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    });

    it('throws NOT_FOUND when token resolves to null', async () => {
      const service = fakeService();
      const links = fakeLinks(null);
      const controller = new CustomerPreferenceController(service, links);

      await expect(
        controller.upsert(
          { token: TOKEN },
          {
            subject_type: SubjectType.CUSTOMER,
            subject_ref: CUSTOMER_PROFILE_ID,
            preferences: [{ channel: CommChannel.SMS, purpose: ConsentPurpose.MARKETING, opted_in: false }],
          },
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    });
  });

  // ── MINOR-6: audit actor_id is SYSTEM_ACTOR_ID, not leadId ──────────────────

  describe('PUT /c/:token/preferences — audit actor (MINOR-6)', () => {
    it('passes SYSTEM_ACTOR_ID as actor.userId, not the lead UUID', async () => {
      const service = fakeService();
      const links = fakeLinks(makeLink());
      const controller = new CustomerPreferenceController(service, links);

      await controller.upsert(
        { token: TOKEN },
        {
          subject_type: SubjectType.CUSTOMER,
          subject_ref: CUSTOMER_PROFILE_ID,
          preferences: [{ channel: CommChannel.WHATSAPP, purpose: ConsentPurpose.MARKETING, opted_in: false }],
        },
      );

      expect(service.upsertBatch).toHaveBeenCalledTimes(1);
      const [, actor] = (service.upsertBatch as jest.Mock).mock.calls[0];
      // Must be the well-known SYSTEM actor, not a lead UUID.
      expect(actor.userId).toBe('00000000-0000-0000-0000-000000000000');
      expect(actor.userId).not.toBe(makeLink().leadId);
    });
  });

  // ── GET /c/:token/preferences ─────────────────────────────────────────────────

  describe('GET /c/:token/preferences', () => {
    it('returns envelope when token is valid and subject matches', async () => {
      const service = fakeService();
      const links = fakeLinks(makeLink());
      const controller = new CustomerPreferenceController(service, links);

      const result = await controller.get(
        { token: TOKEN },
        { subject_type: SubjectType.CUSTOMER, subject_ref: CUSTOMER_PROFILE_ID },
      );

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('error', null);
    });

    it('throws FORBIDDEN when customerProfileId is null on GET', async () => {
      const service = fakeService();
      const links = fakeLinks(makeLink({ customerProfileId: null }));
      const controller = new CustomerPreferenceController(service, links);

      await expect(
        controller.get(
          { token: TOKEN },
          { subject_type: SubjectType.CUSTOMER, subject_ref: CUSTOMER_PROFILE_ID },
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    });
  });
});
