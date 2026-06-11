import { Module, type FactoryProvider } from '@nestjs/common';

import { CONFIG_ACTIVATORS, type ConfigActivatorPort } from './activators/config-activator.port';
import { ConfigActivatorRegistry } from './activators/config-activator.registry';
import { SlaPolicyActivator } from './activators/sla-policy.activator';
import { ConfigGovernanceController } from './config-governance.controller';
import { ConfigGovernanceRepository } from './config-governance.repository';
import { ConfigGovernanceService } from './config-governance.service';
// FR-130 — user / role / team administration.
import { AdminRolesController } from './admin-roles.controller';
import { AdminRoleService } from './admin-role.service';
import { AdminTeamsController } from './admin-teams.controller';
import { AdminTeamService } from './admin-team.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUserService } from './admin-user.service';
import { LEAD_REASSIGN_PORT } from './ports/lead-reassign.port';
import { UnimplementedLeadReassignAdapter } from './ports/unimplemented-lead-reassign.adapter';
import { RoleRepository } from './role.repository';
import { TeamRepository } from './team.repository';
import { UserRepository } from './user.repository';

/**
 * M14 Administration — FR-132 configuration governance (maker-checker). Depends
 * on the global core modules (DB, audit, outbox, auth-core, config).
 *
 * The activation seam ({@link ConfigActivatorRegistry}) is populated via the
 * {@link CONFIG_ACTIVATORS} multi-provider token. This slice wires the
 * `sla_policy` activator ({@link SlaPolicyActivator}); other `config_type`s
 * (product_config, scheme, …) register their own activators against the same
 * token as those modules are built — no change to the governance engine.
 */
/**
 * Multi-provider registration for the `sla_policy` activator. The installed
 * `@nestjs/common` typings omit `multi` from the provider interfaces (it is a
 * supported runtime option), so we declare it as a `FactoryProvider` extended
 * with `multi` and resolve the instance through Nest DI.
 */
const slaPolicyActivatorProvider: FactoryProvider<ConfigActivatorPort> & { multi: true } = {
  provide: CONFIG_ACTIVATORS,
  useFactory: (activator: SlaPolicyActivator): ConfigActivatorPort => activator,
  inject: [SlaPolicyActivator],
  multi: true,
};

@Module({
  controllers: [
    ConfigGovernanceController,
    AdminUsersController,
    AdminRolesController,
    AdminTeamsController,
  ],
  providers: [
    ConfigGovernanceService,
    ConfigGovernanceRepository,
    ConfigActivatorRegistry,
    SlaPolicyActivator,
    slaPolicyActivatorProvider,
    // FR-130 — user / role / team administration.
    AdminUserService,
    AdminRoleService,
    AdminTeamService,
    UserRepository,
    RoleRepository,
    TeamRepository,
    // Owner-writes seam: bulk lead reassignment on deactivation. Wave 2
    // (FR-010/030) rebinds this token to `LeadService.bulkReassign`.
    { provide: LEAD_REASSIGN_PORT, useClass: UnimplementedLeadReassignAdapter },
  ],
  exports: [ConfigGovernanceService],
})
export class AdminModule {}
