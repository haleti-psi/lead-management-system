import { Module } from '@nestjs/common';

import { ConfigActivatorModule } from './activators/config-activator.module';
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
 * on the global core modules (DB, audit, outbox, auth-core, config) and the
 * `@Global` {@link ConfigActivatorModule} that holds the shared
 * {@link ConfigActivatorRegistry}.
 *
 * This slice owns the `sla_policy` activator ({@link SlaPolicyActivator}), which
 * self-registers with the shared registry on init. Other `config_type`s
 * (product_config, scheme, …) own and self-register their own activators from
 * their modules — no change to the governance engine.
 */
@Module({
  imports: [ConfigActivatorModule],
  controllers: [
    ConfigGovernanceController,
    AdminUsersController,
    AdminRolesController,
    AdminTeamsController,
  ],
  providers: [
    ConfigGovernanceService,
    ConfigGovernanceRepository,
    SlaPolicyActivator,
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
