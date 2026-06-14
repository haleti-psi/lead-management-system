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
import { PipelineBoardController } from './pipeline-board.controller';
import { PipelineBoardService } from './pipeline-board.service';
import { LeadSearchRepository } from './repositories/lead-search.repository';
import { PartnerSearchRepository } from './repositories/partner-search.repository';
import { TaskSearchRepository } from './repositories/task-search.repository';
import { SavedViewController } from './saved-view.controller';
import { SavedViewRepository } from './saved-view.repository';
import { SavedViewService } from './saved-view.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * M6 Workspace — FR-050 (lead list, saved work queues, bulk-action gate) +
 * FR-051 (Lead-360 read aggregate) + FR-052 (pipeline board + stage transitions)
 * + FR-053 (role-based dashboard & home) + FR-054 (global search).
 * READ-ONLY on `leads` (owner-writes §11: mutations delegate to the @Global
 * CaptureModule's `LeadService`); sole writer of `saved_views`.
 * `StageGuardService` and `LeadService` are available from the @Global CaptureModule.
 */
@Module({
  controllers: [LeadListController, Lead360Controller, SavedViewController, PipelineBoardController, DashboardController, SearchController],
  providers: [
    LeadScopeService,
    LeadListRepository,
    LeadListService,
    BulkActionService,
    Lead360Repository,
    Lead360Service,
    SavedViewRepository,
    SavedViewService,
    PipelineBoardService,
    DashboardRepository,
    DashboardService,
    // FR-054 — Global Search
    LeadSearchRepository,
    PartnerSearchRepository,
    TaskSearchRepository,
    SearchService,
  ],
})
export class WorkspaceModule {}
