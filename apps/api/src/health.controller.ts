import { Controller, Get } from '@nestjs/common';

// Liveness probe for Cloud Run + deploy-app sanity. Unauthenticated (excluded from
// the global prefix and, in Stage 7, marked @Public()).
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
