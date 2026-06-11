import { AuditAction } from '@lms/shared';

import type { DbTransaction, KyselyDb } from '../db';
import { AuditAppender, type AuditEntry } from './audit-appender.service';

interface CapturedInsert {
  table: string;
  values: Record<string, unknown>;
}

/** A minimal Kysely fake capturing the insertInto(...).values(...).execute() chain. */
function fakeDb(captured: CapturedInsert[]): KyselyDb {
  return {
    insertInto(table: string) {
      return {
        values(values: Record<string, unknown>) {
          return {
            async execute() {
              captured.push({ table, values });
            },
          };
        },
      };
    },
  } as unknown as KyselyDb;
}

describe('AuditAppender', () => {
  it('inserts a fully-formed audit_logs row and serialises detail/ip_device to JSON', async () => {
    const captured: CapturedInsert[] = [];
    const appender = new AuditAppender(fakeDb(captured));

    const entry: AuditEntry = {
      action: AuditAction.LOGIN,
      entity_type: 'users',
      entity_id: 'user-1',
      actor_id: 'user-1',
      org_id: 'org-1',
      detail: { reason: 'ok' },
      ipDevice: { ip: '203.0.113.1', user_agent: 'jest' },
    };
    await appender.append(entry);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.table).toBe('audit_logs');
    expect(captured[0]?.values).toMatchObject({
      org_id: 'org-1',
      actor_id: 'user-1',
      action: 'login',
      entity_type: 'users',
      entity_id: 'user-1',
      lead_id: null,
      detail: JSON.stringify({ reason: 'ok' }),
      ip_device: JSON.stringify({ ip: '203.0.113.1', user_agent: 'jest' }),
    });
    // The appender never writes hash-chain columns (single-writer owns those).
    expect(captured[0]?.values).not.toHaveProperty('prev_audit_hash');
    expect(captured[0]?.values).not.toHaveProperty('after_hash');
  });

  it('stores null detail/ip_device when omitted', async () => {
    const captured: CapturedInsert[] = [];
    const appender = new AuditAppender(fakeDb(captured));

    await appender.append({
      action: AuditAction.LOGIN_FAILED,
      entity_type: 'users',
      entity_id: null,
      actor_id: '00000000-0000-0000-0000-000000000000',
      org_id: 'org-1',
    });

    expect(captured[0]?.values.detail).toBeNull();
    expect(captured[0]?.values.ip_device).toBeNull();
    expect(captured[0]?.values.lead_id).toBeNull();
  });

  it('uses the supplied transaction when one is passed', async () => {
    const poolCaptured: CapturedInsert[] = [];
    const txCaptured: CapturedInsert[] = [];
    const appender = new AuditAppender(fakeDb(poolCaptured));
    const tx = fakeDb(txCaptured) as unknown as DbTransaction;

    await appender.append(
      { action: AuditAction.LOGIN, entity_type: 'users', entity_id: 'u', actor_id: 'u', org_id: 'o' },
      tx,
    );

    expect(txCaptured).toHaveLength(1);
    expect(poolCaptured).toHaveLength(0);
  });
});
