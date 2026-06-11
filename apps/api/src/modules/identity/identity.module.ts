import { Module } from '@nestjs/common';

import { MockChannelAdapter } from '../../core/integration/ports/mock-channel.adapter';
import { NOTIFICATION_CHANNEL_PORT } from '../../core/integration/ports/notification-channel.port';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { AuthSessionStore } from './auth-session.store';
import { BreakGlassController } from './break-glass.controller';
import { BreakGlassExpiryJob } from './break-glass-expiry.job';
import { BreakGlassRepository } from './break-glass.repository';
import { BreakGlassService } from './break-glass.service';
import { TotpService } from './totp.service';

/**
 * M1 Identity & Access — FR-001 (auth, sessions, MFA, password reset) and
 * FR-003 (break-glass privileged access: request/approve/revoke + expiry sweep)
 * wiring. Depends on the global core modules (DB, Redis, audit, auth-core/JWT,
 * config, logging). The {@link NOTIFICATION_CHANNEL_PORT} is bound to the mock
 * channel adapter here; M11 swaps in the real provider adapters in production.
 */
@Module({
  controllers: [AuthController, BreakGlassController],
  providers: [
    AuthService,
    AuthRepository,
    AuthSessionStore,
    TotpService,
    BreakGlassService,
    BreakGlassRepository,
    BreakGlassExpiryJob,
    { provide: NOTIFICATION_CHANNEL_PORT, useClass: MockChannelAdapter },
  ],
  exports: [AuthService],
})
export class IdentityModule {}
