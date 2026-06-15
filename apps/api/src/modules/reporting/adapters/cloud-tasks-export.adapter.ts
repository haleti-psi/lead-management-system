import { Injectable } from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';

import { AppConfigService } from '../../../core/config';
import type { ExportTaskPort } from '../ports/export-task.port';

/**
 * FR-122 — Cloud Tasks adapter that enqueues an export generation task.
 * The target endpoint is `POST /api/v1/internal/exports/generate` (InternalTaskGuard).
 * Uses `@google-cloud/tasks` ^5.
 */
@Injectable()
export class CloudTasksExportAdapter implements ExportTaskPort {
  private readonly client: CloudTasksClient;

  constructor(private readonly config: AppConfigService) {
    this.client = new CloudTasksClient();
  }

  async enqueue(exportJobId: string): Promise<void> {
    const project = this.config.get('GCP_PROJECT');
    const location = this.config.get('CLOUD_TASKS_LOCATION');
    const queue = this.config.get('CLOUD_TASKS_QUEUE');
    const baseUrl = this.config.get('APP_BASE_URL');

    const parent = this.client.queuePath(project, location, queue);
    const url = `${baseUrl}/api/v1/internal/exports/generate`;

    await this.client.createTask({
      parent,
      task: {
        httpRequest: {
          url,
          httpMethod: 'POST' as const,
          headers: {
            'Content-Type': 'application/json',
            'X-CloudTasks-QueueName': queue,
          },
          body: Buffer.from(JSON.stringify({ export_job_id: exportJobId })).toString('base64'),
        },
      },
    });
  }
}
