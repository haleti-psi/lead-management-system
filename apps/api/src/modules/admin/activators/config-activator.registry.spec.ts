import type { DbTransaction } from '../../../core/db';
import { ConfigActivatorRegistry } from './config-activator.registry';
import type { ConfigActivatorPort, ConfigurationVersionRow } from './config-activator.port';
import { SlaPolicyActivator } from './sla-policy.activator';

/**
 * FR-132 — the activation seam. The registry indexes activators by `configType`,
 * returns `undefined` for unregistered types (status-only governance), and fails
 * fast on a duplicate registration (wiring error).
 */

function stubActivator(configType: string): ConfigActivatorPort {
  return {
    configType,
    activate: jest.fn(),
    deactivate: jest.fn(),
  } as unknown as ConfigActivatorPort;
}

describe('ConfigActivatorRegistry', () => {
  it('resolves a registered activator by config_type', () => {
    const sla = stubActivator('sla_policy');
    const registry = new ConfigActivatorRegistry([sla]);
    expect(registry.resolve('sla_policy')).toBe(sla);
  });

  it('returns undefined for an unregistered config_type', () => {
    const registry = new ConfigActivatorRegistry([stubActivator('sla_policy')]);
    expect(registry.resolve('product_config')).toBeUndefined();
  });

  it('tolerates a null injection (no activators bound yet)', () => {
    const registry = new ConfigActivatorRegistry(null);
    expect(registry.resolve('sla_policy')).toBeUndefined();
  });

  it('throws on a duplicate config_type registration', () => {
    expect(() => new ConfigActivatorRegistry([stubActivator('sla_policy'), stubActivator('sla_policy')])).toThrow(
      /Duplicate ConfigActivatorPort/,
    );
  });
});

/** A minimal Kysely-update chain spy for the activator's single-table UPDATE. */
interface UpdateChainSpy {
  set: jest.Mock;
  where: jest.Mock;
  execute: jest.Mock;
}

function txSpy() {
  const execute = jest.fn().mockResolvedValue(undefined);
  const chain: UpdateChainSpy = {
    set: jest.fn((): UpdateChainSpy => chain),
    where: jest.fn((): UpdateChainSpy => chain),
    execute,
  };
  const updateTable = jest.fn((): UpdateChainSpy => chain);
  return { tx: { updateTable } as unknown as DbTransaction, updateTable, chain, execute };
}

function slaRow(overrides: Partial<ConfigurationVersionRow> = {}): ConfigurationVersionRow {
  return {
    configuration_version_id: 'cv-1',
    org_id: '00000000-0000-0000-0000-000000000001',
    config_type: 'sla_policy',
    config_ref: 'pol-1',
    version: 1,
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

describe('SlaPolicyActivator', () => {
  it('handles config_type sla_policy', () => {
    expect(new SlaPolicyActivator().configType).toBe('sla_policy');
  });

  it('activate sets sla_policies.is_active=true scoped to the policy', async () => {
    const { tx, updateTable, chain } = txSpy();
    await new SlaPolicyActivator().activate(slaRow(), tx);
    expect(updateTable).toHaveBeenCalledWith('sla_policies');
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ is_active: true }));
    expect(chain.where).toHaveBeenCalledWith('sla_policy_id', '=', 'pol-1');
  });

  it('deactivate sets sla_policies.is_active=false', async () => {
    const { tx, chain } = txSpy();
    await new SlaPolicyActivator().deactivate(slaRow(), tx);
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }));
  });

  it('is a no-op when config_ref is null', async () => {
    const { tx, updateTable } = txSpy();
    await new SlaPolicyActivator().activate(slaRow({ config_ref: null }), tx);
    expect(updateTable).not.toHaveBeenCalled();
  });
});
