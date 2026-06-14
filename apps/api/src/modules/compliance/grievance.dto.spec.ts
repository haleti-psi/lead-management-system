/**
 * FR-114 DTO validation tests (FR-114-tests.md T09/T10/T11 — Zod schema tier).
 */

import { GrievanceCategory, GrievanceSource, GrievanceStatus } from '@lms/shared';
import { CreateGrievanceDto } from './dto/create-grievance.dto';
import { UpdateGrievanceDto } from './dto/update-grievance.dto';
import { ListGrievancesQuery } from './dto/list-grievances.dto';

// ─────────────────────────────────────── CreateGrievanceDto ──

describe('CreateGrievanceDto', () => {
  it('T11: empty body fails with required errors for source, category, description', () => {
    const result = CreateGrievanceDto.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path[0]);
      expect(fields).toContain('source');
      expect(fields).toContain('category');
      expect(fields).toContain('description');
    }
  });

  it('T09: description too short fails', () => {
    const result = CreateGrievanceDto.safeParse({
      source: GrievanceSource.RM,
      category: GrievanceCategory.SERVICE_DELAY,
      description: 'short',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path[0]);
      expect(fields).toContain('description');
    }
  });

  it('T10: invalid source enum fails', () => {
    const result = CreateGrievanceDto.safeParse({
      source: 'twitter',
      category: GrievanceCategory.SERVICE_DELAY,
      description: 'A long enough description here.',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path[0]);
      expect(fields).toContain('source');
    }
  });

  it('description at max 2000 chars passes', () => {
    const result = CreateGrievanceDto.safeParse({
      source: GrievanceSource.RM,
      category: GrievanceCategory.MIS_SELLING,
      description: 'a'.repeat(2000),
    });
    expect(result.success).toBe(true);
  });

  it('description over 2000 chars fails', () => {
    const result = CreateGrievanceDto.safeParse({
      source: GrievanceSource.RM,
      category: GrievanceCategory.MIS_SELLING,
      description: 'a'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it('optional leadId and ownerId default to null when absent', () => {
    const result = CreateGrievanceDto.safeParse({
      source: GrievanceSource.BRANCH,
      category: GrievanceCategory.DATA_PRIVACY,
      description: 'A valid description of at least 10 chars.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.leadId).toBeNull();
      expect(result.data.ownerId).toBeNull();
    }
  });

  it('invalid UUID in leadId fails', () => {
    const result = CreateGrievanceDto.safeParse({
      source: GrievanceSource.RM,
      category: GrievanceCategory.SERVICE_DELAY,
      description: 'A valid description.',
      leadId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('valid UUID in leadId passes', () => {
    const result = CreateGrievanceDto.safeParse({
      source: GrievanceSource.RM,
      category: GrievanceCategory.SERVICE_DELAY,
      description: 'A valid description of at least 10 chars.',
      leadId: 'a0000000-0000-0000-0000-000000000001',
    });
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────── UpdateGrievanceDto ──

describe('UpdateGrievanceDto', () => {
  it('empty body fails — at least one field required', () => {
    const result = UpdateGrievanceDto.safeParse({});
    expect(result.success).toBe(false);
  });

  it('invalid status enum fails', () => {
    const result = UpdateGrievanceDto.safeParse({ status: 'pending' });
    expect(result.success).toBe(false);
  });

  it('valid status only passes', () => {
    const result = UpdateGrievanceDto.safeParse({ status: GrievanceStatus.IN_PROGRESS });
    expect(result.success).toBe(true);
  });

  it('response only passes', () => {
    const result = UpdateGrievanceDto.safeParse({ response: 'Issue resolved.' });
    expect(result.success).toBe(true);
  });

  it('closureProofRef only passes', () => {
    const result = UpdateGrievanceDto.safeParse({
      closureProofRef: 'gcs://bucket/proof.pdf',
    });
    expect(result.success).toBe(true);
  });

  it('ownerId only passes with valid UUID', () => {
    const result = UpdateGrievanceDto.safeParse({
      ownerId: 'a0000000-0000-0000-0000-000000000001',
    });
    expect(result.success).toBe(true);
  });

  it('invalid ownerId UUID fails', () => {
    const result = UpdateGrievanceDto.safeParse({ ownerId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('all valid fields together pass', () => {
    const result = UpdateGrievanceDto.safeParse({
      status: GrievanceStatus.RESOLVED,
      response: 'Issue addressed by RM.',
      ownerId: 'a0000000-0000-0000-0000-000000000001',
    });
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────── ListGrievancesQuery ──

describe('ListGrievancesQuery', () => {
  it('parses defaults when empty', () => {
    const result = ListGrievancesQuery.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(25);
      expect(result.data.sort).toEqual({ column: 'created_at', dir: 'desc' });
    }
  });

  it('coerces string page/limit to numbers', () => {
    const result = ListGrievancesQuery.safeParse({ page: '2', limit: '10' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(10);
    }
  });

  it('T05: limit capped at 100', () => {
    const result = ListGrievancesQuery.safeParse({ limit: '150' });
    expect(result.success).toBe(false);
  });

  it('invalid status enum fails', () => {
    const result = ListGrievancesQuery.safeParse({ status: 'unknown' });
    expect(result.success).toBe(false);
  });

  it('valid status filter passes', () => {
    const result = ListGrievancesQuery.safeParse({ status: GrievanceStatus.OPEN });
    expect(result.success).toBe(true);
  });

  it('sort=sla_due_at parsed as asc column', () => {
    const result = ListGrievancesQuery.safeParse({ sort: 'sla_due_at' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toEqual({ column: 'sla_due_at', dir: 'asc' });
    }
  });

  it('sort=-sla_due_at parsed as desc column', () => {
    const result = ListGrievancesQuery.safeParse({ sort: '-sla_due_at' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toEqual({ column: 'sla_due_at', dir: 'desc' });
    }
  });

  it('unknown sort column falls back to created_at', () => {
    const result = ListGrievancesQuery.safeParse({ sort: '-unknown_column' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort.column).toBe('created_at');
    }
  });
});
