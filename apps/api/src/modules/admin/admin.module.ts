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
import { LeadReassignmentAdapter } from '../capture/adapters/lead-reassignment.adapter';
import { LEAD_REASSIGN_PORT } from './ports/lead-reassign.port';
import { RoleRepository } from './role.repository';
import { TeamRepository } from './team.repository';
import { UserRepository } from './user.repository';
// FR-131 — generic master/config CRUD (`/admin/{masterResource}`).
import { AdminMasterController } from './master/admin-master.controller';
import { AdminMasterRepository } from './master/admin-master.repository';
import { AdminMasterService } from './master/admin-master.service';
import { MasterResourceRegistry } from './master/master-resource.registry';

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
    // FR-130 — concrete `/admin/users|roles|teams` (registered before the FR-131
    // generic `/admin/{masterResource}` so the static routes take precedence).
    AdminUsersController,
    AdminRolesController,
    AdminTeamsController,
    // FR-131 — generic master/config CRUD (allow-list excludes all of the above).
    AdminMasterController,
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
    // FR-131 — master configuration.
    MasterResourceRegistry,
    AdminMasterService,
    AdminMasterRepository,
    // Owner-writes seam: bulk lead reassignment on deactivation — bound (FR-010,
    // Wave 2) to the capture module's adapter over `LeadService.bulkReassign`.
    // `LeadReassignmentAdapter` is exported by the @Global CaptureModule.
    { provide: LEAD_REASSIGN_PORT, useExisting: LeadReassignmentAdapter },
  ],
  exports: [ConfigGovernanceService],
})
export class AdminModule {}
