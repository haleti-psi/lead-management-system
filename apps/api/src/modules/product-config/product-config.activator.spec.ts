import type { DbTransaction } from '../../core/db';
import { ConfigActivatorRegistry } from '../admin/activators/config-activator.registry';
import type { ConfigurationVersionRow } from '../admin/activators/config-activator.port';
import { ProductConfigActivator } from './product-config.activator';

/**
 * FR-040 — the `product_config` activation seam that plugs into FR-132. The
 * governance engine resolves this by `config_type='product_config'` when a pending
 * version is approved (→ {@link activate}) or rolled back (→ {@link deactivate}),
 * inside the governance transaction. `activate` promotes the referenced draft to
 * `status='active'` and retires the previously-active sibling for the same
 * product_code (INV-01: one active config per product_code). `deactivate` retires
 * the referenced row. No `leads` row is ever touched (version pinning, TC-A20).
 */

interface SelectChain {
  select: jest.Mock;
  where: jest.Mock;
  executeTakeFirst: jest.Mock;
}

interface UpdateChain {
  set: jest.Mock;
  where: jest.Mock;
  execute: jest.Mock;
}

interface UpdateRecord {
  set: Record<string, unknown>;
  wheres: Array<[string, string, unknown]>;
}

/** A minimal Kysely chain spy supporting one SELECT and any number of UPDATEs. */
function txSpy(target: { product_config_id: string; product_code: string } | undefined) {
  const selectChain: SelectChain = {
    select: jest.fn(() => selectChain),
    where: jest.fn(() => selectChain),
    executeTakeFirst: jest.fn().mockResolvedValue(target),
  };
  const selectFrom = jest.fn(() => selectChain);

  const updateCalls: UpdateRecord[] = [];
  const updateTable = jest.fn(() => {
    const record: UpdateRecord = { set: {}, wheres: [] };
    const chain: UpdateChain = {
      set: jest.fn((value: Record<string, unknown>) => {
        record.set = value;
        return chain;
      }),
      where: jest.fn((...args: [string, string, unknown]) => {
        record.wheres.push(args);
        return chain;
      }),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    updateCalls.push(record);
    return chain;
  });

  const tx = { selectFrom, updateTable } as unknown as DbTransaction;
  return { tx, selectFrom, updateTable, updateCalls };
}

function cvRow(overrides: Partial<ConfigurationVersionRow> = {}): ConfigurationVersionRow {
  return {
    configuration_version_id: 'cv-1',
    org_id: '00000000-0000-0000-0000-000000000001',
    config_type: 'product_config',
    config_ref: 'pc-new',
    version: 4,
    maker_id: 'maker-1',
    checker_id: 'checker-1',
    status: 'active',
    effective_at: null,
    rollback_ref: null,
    diff: null,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: 'maker-1',
    updated_by: 'checker-1',
    ...overrides,
  } as ConfigurationVersionRow;
}

describe('ProductConfigActivator', () => {
  const make = (): ProductConfigActivator => new ProductConfigActivator(new ConfigActivatorRegistry());

  it('handles config_type product_config', () => {
    expect(make().configType).toBe('product_config');
  });

  it('self-registers with the shared registry on init', () => {
    const registry = new ConfigActivatorRegistry();
    const activator = new ProductConfigActivator(registry);
    activator.onModuleInit();
    expect(registry.resolve('product_config')).toBe(activator);
  });

  it('activate promotes the referenced config to active and retires the prior active sibling', async () => {
    const { tx, updateCalls } = txSpy({ product_config_id: 'pc-new', product_code: 'CV' });

    await make().activate(cvRow(), tx);

    // Two UPDATEs: (1) retire siblings, (2) promote the new row.
    expect(updateCalls).toHaveLength(2);

    const retire = updateCalls[0];
    expect(retire.set.status).toBe('retired');
    expect(retire.wheres).toEqual(
      expect.arrayContaining([
        ['product_code', '=', 'CV'],
        ['status', '=', 'active'],
        ['product_config_id', '!=', 'pc-new'],
      ]),
    );

    const promote = updateCalls[1];
    expect(promote.set.status).toBe('active');
    expect(promote.wheres).toEqual(expect.arrayContaining([['product_config_id', '=', 'pc-new']]));
  });

  it('activate is a no-op when config_ref is null', async () => {
    const { tx, selectFrom, updateTable } = txSpy(undefined);
    await make().activate(cvRow({ config_ref: null }), tx);
    expect(selectFrom).not.toHaveBeenCalled();
    expect(updateTable).not.toHaveBeenCalled();
  });

  it('activate is a no-op when the target row no longer exists', async () => {
    const { tx, updateTable } = txSpy(undefined);
    await make().activate(cvRow(), tx);
    expect(updateTable).not.toHaveBeenCalled();
  });

  it('deactivate retires the referenced config (rollback path)', async () => {
    const { tx, updateCalls } = txSpy({ product_config_id: 'pc-new', product_code: 'CV' });

    await make().deactivate(cvRow(), tx);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set.status).toBe('retired');
    expect(updateCalls[0].wheres).toEqual(expect.arrayContaining([['product_config_id', '=', 'pc-new']]));
  });

  it('deactivate is a no-op when config_ref is null', async () => {
    const { tx, updateTable } = txSpy(undefined);
    await make().deactivate(cvRow({ config_ref: null }), tx);
    expect(updateTable).not.toHaveBeenCalled();
  });
});
