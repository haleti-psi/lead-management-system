import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

/** Seeded by V1 (the default NBFC org + the reserved system actor). */
export const ORG = '00000000-0000-0000-0000-000000000001';
export const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';

export interface SeededLead {
  leadId: string;
  leadIdentityId: string;
}

function validMobile(): string {
  return '9' + Math.floor(Math.random() * 1e9).toString().padStart(9, '0');
}

/**
 * Seed a lead (+ identity + source attribution) in a terminal stage, with a
 * stage_history row dated `terminalDaysAgo` days in the past so the retention
 * cutoff query selects it. Reuses a V2-seeded product_config (and its code).
 */
export async function seedCustomerProfile(
  pool: Pool,
  opts: { mobile?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO customer_profiles (customer_profile_id, org_id, primary_mobile, display_name, customer_type, created_by, updated_by)
     VALUES ($1,$2,$3,'Real Customer','individual',$4,$4)`,
    [id, ORG, opts.mobile ?? validMobile(), SYSTEM_USER],
  );
  return id;
}

export async function seedLead(
  pool: Pool,
  opts: { stage?: string; terminalDaysAgo?: number; name?: string; customerProfileId?: string } = {},
): Promise<SeededLead> {
  const stage = opts.stage ?? 'rejected';
  const daysAgo = opts.terminalDaysAgo ?? 400;
  const leadIdentityId = randomUUID();
  const sourceAttrId = randomUUID();
  const leadId = randomUUID();
  const leadCode = 'LD-T-' + leadId.slice(0, 10);

  const pc = await pool.query<{ product_config_id: string; product_code: string }>(
    'SELECT product_config_id, product_code FROM product_configs LIMIT 1',
  );
  const { product_config_id, product_code } = pc.rows[0]!;

  await pool.query(
    `INSERT INTO lead_identities (lead_identity_id, org_id, name, mobile, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$5)`,
    [leadIdentityId, ORG, opts.name ?? 'Test Subject', validMobile(), SYSTEM_USER],
  );
  await pool.query(
    `INSERT INTO source_attributions (source_attribution_id, org_id, source, creator_channel, created_by, updated_by)
     VALUES ($1,$2,'Website','manual',$3,$3)`,
    [sourceAttrId, ORG, SYSTEM_USER],
  );
  await pool.query(
    `INSERT INTO leads (lead_id, org_id, lead_code, stage, product_code, product_config_id,
                        source_attribution_id, lead_identity_id, customer_profile_id, channel_created_by, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$10)`,
    [leadId, ORG, leadCode, stage, product_code, product_config_id, sourceAttrId, leadIdentityId, opts.customerProfileId ?? null, SYSTEM_USER],
  );
  await pool.query(
    `INSERT INTO stage_history (org_id, lead_id, to_stage, actor_id, created_at, occurred_at)
     VALUES ($1,$2,$3,$4, now() - ($5 || ' days')::interval, now() - ($5 || ' days')::interval)`,
    [ORG, leadId, stage, SYSTEM_USER, String(daysAgo)],
  );

  return { leadId, leadIdentityId };
}

export async function seedRetentionPolicy(
  pool: Pool,
  opts: { action?: string; dataCategory?: string; retainDays?: number; legalHold?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO retention_policies (retention_policy_id, org_id, data_category, lead_outcome,
                                     retain_days, action, legal_hold, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,'rejected',$4,$5,$6,true,$7,$7)`,
    [
      id,
      ORG,
      opts.dataCategory ?? 'identity',
      opts.retainDays ?? 30,
      opts.action ?? 'purge',
      opts.legalHold ?? false,
      SYSTEM_USER,
    ],
  );
  return id;
}

export async function seedOpenGrievance(pool: Pool, leadId: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO grievances (grievance_id, org_id, grievance_no, lead_id, source, category, description, status, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'customer_link','data_privacy','test grievance','open',$5,$5)`,
    [id, ORG, 'GRV-' + id.slice(0, 8), leadId, SYSTEM_USER],
  );
  return id;
}
