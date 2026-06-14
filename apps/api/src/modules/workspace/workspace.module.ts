import { Module } from '@nestjs/common';

import { BulkActionService } from './bulk-action.service';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { DashboardService } from './dashboard.service';
import { LeadListController } from './lead-list.controller';
import { LeadListRepository } from './lead-list.repository';
import { LeadListService } from './lead-list.service';
import { LeadScopeService } from './lead-scope.service';
import { Lead360Controller } from './lead360.controller';
import { Lead360Repository } from './lead360.repository';
import { Lead360Service } from './lead360.service';
import { SavedViewController } from './saved-view.controller';
import { SavedViewRepository } from './saved-view.repository';
import { SavedViewService } from './saved-view.service';

/**
 * M6 Workspace — FR-050 (lead list, saved work queues, bulk-action gate) +
 * FR-051 (Lead-360 read aggregate) + FR-053 (role-based dashboard & home).
 * READ-ONLY on `leads` (owner-writes §11: bulk mutations delegate to the
 * @Global CaptureModule's `LeadService`); sole writer of `saved_views`.
 * Depends only on the global core modules (DB, auth-core, audit, masking, redis).
 */
@Module({
  controllers: [LeadListController, Lead360Controller, SavedViewController, DashboardController],
  providers: [
    LeadScopeService,
    LeadListRepository,
    LeadListService,
    BulkActionService,
    Lead360Repository,
    Lead360Service,
    SavedViewRepository,
    SavedViewService,
    DashboardRepository,
    DashboardService,
  ],
})
export class WorkspaceModule {}
