import { Module } from '@nestjs/common';

import { MockChannelAdapter } from '../../core/integration/ports/mock-channel.adapter';
import { NOTIFICATION_CHANNEL_PORT } from '../../core/integration/ports/notification-channel.port';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { AuthSessionStore } from './auth-session.store';
import { TotpService } from './totp.service';

/**
 * M1 Identity & Access — FR-001 wiring (auth, sessions, MFA, password reset).
 * Depends on the global core modules (DB, Redis, audit, auth-core/JWT, config,
 * logging). The {@link NOTIFICATION_CHANNEL_PORT} is bound to the mock channel
 * adapter here; M11 swaps in the real provider adapters in production.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    AuthSessionStore,
    TotpService,
    { provide: NOTIFICATION_CHANNEL_PORT, useClass: MockChannelAdapter },
  ],
  exports: [AuthService],
})
export class IdentityModule {}
