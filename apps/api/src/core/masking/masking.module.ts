import { Global, Module } from '@nestjs/common';

import { MaskingInterceptor } from './masking.interceptor';
import { MaskingService } from './masking.service';

/**
 * FR-002 masking module (architecture §3 core/). Exposes the pure
 * {@link MaskingService} and the {@link MaskingInterceptor}. The interceptor is
 * registered globally in AppModule (after the response-envelope interceptor) so
 * every ABAC-scoped response is masked on serialisation; the service is exported
 * for exports/other FRs that mask outside the HTTP path.
 */
@Global()
@Module({
  providers: [MaskingService, MaskingInterceptor],
  exports: [MaskingService, MaskingInterceptor],
})
export class MaskingModule {}
