import type { DbTransaction } from '../../../core/db';
import { ProductConfigActivator } from '../../product-config/product-config.activator';
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
    const registry = new ConfigActivatorRegistry();
    registry.register(sla);
    expect(registry.resolve('sla_policy')).toBe(sla);
  });

  it('returns undefined for an unregistered config_type', () => {
    const registry = new ConfigActivatorRegistry();
    registry.register(stubActivator('sla_policy'));
    expect(registry.resolve('product_config')).toBeUndefined();
  });

  it('returns undefined when nothing is registered yet', () => {
    const registry = new ConfigActivatorRegistry();
    expect(registry.resolve('sla_policy')).toBeUndefined();
  });

  it('throws on a duplicate config_type registration', () => {
    const registry = new ConfigActivatorRegistry();
    registry.register(stubActivator('sla_policy'));
    expect(() => registry.register(stubActivator('sla_policy'))).toThrow(/Duplicate ConfigActivatorPort/);
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
  const make = (): SlaPolicyActivator => new SlaPolicyActivator(new ConfigActivatorRegistry());

  it('handles config_type sla_policy', () => {
    expect(make().configType).toBe('sla_policy');
  });

  it('activate sets sla_policies.is_active=true scoped to the policy', async () => {
    const { tx, updateTable, chain } = txSpy();
    await make().activate(slaRow(), tx);
    expect(updateTable).toHaveBeenCalledWith('sla_policies');
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ is_active: true }));
    expect(chain.where).toHaveBeenCalledWith('sla_policy_id', '=', 'pol-1');
  });

  it('deactivate sets sla_policies.is_active=false', async () => {
    const { tx, chain } = txSpy();
    await make().deactivate(slaRow(), tx);
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }));
  });

  it('is a no-op when config_ref is null', async () => {
    const { tx, updateTable } = txSpy();
    await make().activate(slaRow({ config_ref: null }), tx);
    expect(updateTable).not.toHaveBeenCalled();
  });

  it('self-registers with the shared registry on init', () => {
    const registry = new ConfigActivatorRegistry();
    const activator = new SlaPolicyActivator(registry);
    activator.onModuleInit();
    expect(registry.resolve('sla_policy')).toBe(activator);
  });
});

/**
 * Cross-module wiring (Batch-2 integration): the `sla_policy` (M14) and
 * `product_config` (M5) activators live in different Nest modules but MUST
 * converge on the SAME shared registry. After both modules initialise, the
 * governance engine must resolve BOTH — proving multi-module registration no
 * longer relies on a per-module multi-provider token (which does not aggregate
 * across module scopes). Regression guard for the silent product_config no-op.
 */
describe('ConfigActivatorRegistry — cross-module registration', () => {
  it('resolves both activators after each self-registers on the shared instance', () => {
    const registry = new ConfigActivatorRegistry();
    const sla = new SlaPolicyActivator(registry);
    const product = new ProductConfigActivator(registry);

    // Each module's onModuleInit runs independently against the one registry.
    sla.onModuleInit();
    product.onModuleInit();

    expect(registry.resolve('sla_policy')).toBe(sla);
    expect(registry.resolve('product_config')).toBe(product);
  });
});
