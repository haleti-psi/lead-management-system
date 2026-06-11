import { Controller, Get } from '@nestjs/common';

import { Public } from './core/auth';

// Liveness probe for Cloud Run + deploy-app sanity. Unauthenticated: excluded
// from the global prefix and @Public() so the global JwtAuthGuard lets it through.
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
