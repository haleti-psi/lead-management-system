import 'reflect-metadata';

import type { PinoLogger } from 'nestjs-pino';

import { MaskingService } from '../../core/masking';
import type { LeadSearchRow } from './repositories/lead-search.repository';
import { LeadSearchRepository } from './repositories/lead-search.repository';
import type { PartnerSearchRow } from './repositories/partner-search.repository';
import { PartnerSearchRepository } from './repositories/partner-search.repository';
import type { TaskSearchRow } from './repositories/task-search.repository';
import { TaskSearchRepository } from './repositories/task-search.repository';
import { SearchService } from './search.service';
import type { AuthUser, MaskingLevel } from '../../core/auth';
import type { ScopePredicate } from '@lms/shared';

function makeMockLogger(): PinoLogger {
  return {
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
  } as unknown as PinoLogger;
}

const ownPredicate: ScopePredicate = { type: 'own', userId: 'user-1' };

const mockUser: AuthUser = {
  userId: 'user-1',
  orgId: 'org-1',
  role: 'RM',
  scope: 'O',
  jti: 'jti-1',
};

const sampleLead: LeadSearchRow = {
  lead_id: 'lead-uuid-1',
  lead_code: 'LD-2026-000001',
  stage: 'documents_pending',
  product_code: 'CV',
  applicant_name: 'Ravi Kumar',
  mobile: '9876543210',
  pan_masked: 'ABCxxxx4F',
  owner_id: 'user-1',
  branch_id: 'branch-1',
  created_at: new Date('2026-01-01T00:00:00Z'),
};

const samplePartner: PartnerSearchRow = {
  partner_id: 'partner-uuid-1',
  partner_code: 'DSA-001',
  legal_name: 'ABC Finance DSA',
  type: 'DSA',
  status: 'active',
};

const sampleTask: TaskSearchRow = {
  task_id: 'task-uuid-1',
  type: 'call',
  lead_id: 'lead-uuid-1',
  lead_code: 'LD-2026-000001',
  due_at: new Date('2026-06-15T10:00:00Z'),
  status: 'open',
  priority: 'high',
};

function makeService(
  leadRows: LeadSearchRow[] = [],
  partnerRows: PartnerSearchRow[] = [],
  taskRows: TaskSearchRow[] = [],
  leadThrow = false,
) {
  const leadRepo = {
    search: leadThrow
      ? jest.fn().mockRejectedValue(new Error('DB failure'))
      : jest.fn().mockResolvedValue(leadRows),
  } as unknown as LeadSearchRepository;

  const partnerRepo = {
    search: jest.fn().mockResolvedValue(partnerRows),
  } as unknown as PartnerSearchRepository;

  const taskRepo = {
    search: jest.fn().mockResolvedValue(taskRows),
  } as unknown as TaskSearchRepository;

  const masking = new MaskingService();
  const logger = makeMockLogger();

  return new SearchService(leadRepo, partnerRepo, taskRepo, masking, logger);
}

describe('SearchService', () => {
  describe('masking', () => {
    it('T14 — mobile is always masked for all roles (RM)', async () => {
      const svc = makeService([sampleLead]);
      const result = await svc.search('Ravi', mockUser, ownPredicate, 'partial');
      expect(result.leads[0]?.mobile).toBe('98xxxxxx10');
    });

    it('T14 — raw mobile is never returned in lead results', async () => {
      const svc = makeService([sampleLead]);
      const result = await svc.search('Ravi', mockUser, ownPredicate, 'partial');
      expect(result.leads[0]?.mobile).not.toBe('9876543210');
    });

    it('T15 — DPO receives strictly-masked name (first name only)', async () => {
      const svc = makeService([sampleLead]);
      const dpoUser: AuthUser = { ...mockUser, role: 'DPO', scope: 'M' };
      const masked: MaskingLevel = 'strict';
      const result = await svc.search('Ravi', dpoUser, { type: 'masked', orgId: 'org-1' }, masked);
      // Strict masking reduces full name to first token
      expect(result.leads[0]?.applicant_name).toBe('Ravi');
      expect(result.leads[0]?.applicant_name).not.toContain('Kumar');
    });

    it('partial masking leaves name intact for RM', async () => {
      const svc = makeService([sampleLead]);
      const result = await svc.search('Ravi', mockUser, ownPredicate, 'partial');
      expect(result.leads[0]?.applicant_name).toBe('Ravi Kumar');
    });

    it('T21 — pan_masked from DB is passed through as-is (never re-masked)', async () => {
      const svc = makeService([sampleLead]);
      const result = await svc.search('Ravi', mockUser, ownPredicate, 'partial');
      expect(result.leads[0]?.pan_masked).toBe('ABCxxxx4F');
    });
  });

  describe('result assembly', () => {
    it('T16 — returns empty arrays for all buckets when no match', async () => {
      const svc = makeService([], [], []);
      const result = await svc.search('ZZNOTEXIST', mockUser, ownPredicate, 'partial');
      expect(result.leads).toHaveLength(0);
      expect(result.partners).toHaveLength(0);
      expect(result.tasks).toHaveLength(0);
    });

    it('returns all three entity buckets when all match', async () => {
      const svc = makeService([sampleLead], [samplePartner], [sampleTask]);
      const result = await svc.search('LD-2026', mockUser, ownPredicate, 'partial');
      expect(result.leads).toHaveLength(1);
      expect(result.partners).toHaveLength(1);
      expect(result.tasks).toHaveLength(1);
    });

    it('topN is 5', () => {
      const svc = makeService();
      expect(svc.topN).toBe(5);
    });
  });

  describe('T17 — graceful degradation on partial sub-query failure', () => {
    it('returns empty leads bucket when lead sub-query throws; partners and tasks still populated', async () => {
      const svc = makeService([], [samplePartner], [sampleTask], /* leadThrow */ true);
      const result = await svc.search('Kumar', mockUser, ownPredicate, 'partial');
      expect(result.leads).toHaveLength(0);
      expect(result.partners).toHaveLength(1);
      expect(result.tasks).toHaveLength(1);
    });
  });
});
