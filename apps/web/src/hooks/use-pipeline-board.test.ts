// @vitest-environment node
//
// FR-052 — unit tests for the board row→card mapping (`toCard`). This is the
// projection the board depends on: the live `GET /leads` returns the contract
// `Lead` shape (snake_case, masked) which must map onto the camelCase card.
import { describe, it, expect } from 'vitest';

import { toCard } from './use-pipeline-board';
import type { BoardLeadRow } from '@/components/pipeline/pipeline-board.types';

function row(overrides: Partial<BoardLeadRow> = {}): BoardLeadRow {
  return {
    lead_id: 'id-1',
    lead_code: 'LD-2026-000001',
    stage: 'captured',
    product_code: 'CV',
    is_hot: true,
    score: 42,
    consent_status: 'pending',
    kyc_status: 'not_started',
    name_masked: 'Su**** P****',
    mobile_masked: '98xxxxxx05',
    requested_amount: '500000.00',
    owner_name: 'Anita Sharma',
    ageing_days: 3,
    version: 2,
    ...overrides,
  } as BoardLeadRow;
}

describe('toCard', () => {
  it('maps the snake_case /leads row onto the board card', () => {
    expect(toCard(row())).toMatchObject({
      leadId: 'id-1',
      leadCode: 'LD-2026-000001',
      stage: 'captured',
      productCode: 'CV',
      isHot: true,
      score: 42,
      consentStatus: 'pending',
      kycStatus: 'not_started',
      customerName: 'Su**** P****',
    });
  });

  it('falls back to an em-dash when the masked name is null', () => {
    expect(toCard(row({ name_masked: null })).customerName).toBe('—');
  });

  it('maps the enriched projection fields (amount / owner / ageing / version)', () => {
    const card = toCard(row());
    expect(card.requestedAmount).toBe('500000.00');
    expect(card.ownerName).toBe('Anita Sharma');
    expect(card.ageingDays).toBe(3);
    expect(card.version).toBe(2);
  });
});
