import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../../core/auth';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
} from '../../core/auth/auth.constants';
import { ZodValidationPipe } from '../../core/common';
import { AppConfigService } from '../../core/config';
import { readHeader, type HttpRequestLike, type HttpResponseLike } from '../../core/http/http-types';
import { parseDurationSeconds } from '../../core/auth/token.service';
import { AuthService } from './auth.service';
import { LoginDto, MfaDto, ResetDto } from './auth.dto';
import type { AuthOutcome, AuthRequestContext } from './auth.types';

/**
 * FR-001 authentication endpoints. All four are `@Public()` (auth-matrix
 * `public_endpoints`) — the only routes exempt from the global JwtAuthGuard —
 * and rate-limited to 10/min per IP by the global throttler (auth tier). The
 * refresh token is set/read as an httpOnly, Secure, SameSite=Strict cookie;
 * controllers return plain data and the global interceptor wraps the envelope.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(LoginDto)) dto: LoginDto,
    @Req() req: HttpRequestLike,
    @Res({ passthrough: true }) res: HttpResponseLike,
  ): Promise<unknown> {
    const outcome = await this.auth.login(dto.username, dto.password, this.context(req));
    return this.respond(outcome, res);
  }

  @Public()
  @Post('mfa')
  async mfa(
    @Body(new ZodValidationPipe(MfaDto)) dto: MfaDto,
    @Req() req: HttpRequestLike,
    @Res({ passthrough: true }) res: HttpResponseLike,
  ): Promise<unknown> {
    const outcome = await this.auth.verifyMfa(dto.mfa_challenge_token, dto.otp, this.context(req));
    return this.respond(outcome, res);
  }

  @Public()
  @SkipThrottle() // refresh inherits the default tier; the LLD applies no extra throttle here
  @Post('refresh')
  async refresh(
    @Req() req: HttpRequestLike,
    @Res({ passthrough: true }) res: HttpResponseLike,
  ): Promise<unknown> {
    const token = this.readRefreshCookie(req);
    const outcome = await this.auth.refresh(token, this.context(req));
    return this.respond(outcome, res);
  }

  @Public()
  @Post('reset')
  async reset(
    @Body(new ZodValidationPipe(ResetDto)) dto: ResetDto,
    @Req() req: HttpRequestLike,
  ): Promise<null> {
    await this.auth.initiatePasswordReset(dto.email, this.context(req));
    // Always 200 with data:null — identical whether the email matched or not.
    return null;
  }

  // ── helpers ──────────────────────────────────────────────────

  private respond(outcome: AuthOutcome, res: HttpResponseLike): unknown {
    if (outcome.kind === 'challenge') {
      return outcome.body;
    }
    this.setRefreshCookie(res, outcome.refreshToken);
    return outcome.body;
  }

  private context(req: HttpRequestLike): AuthRequestContext {
    const ip = (req as HttpRequestLike & { ip?: string }).ip;
    return { ip, userAgent: readHeader(req, 'user-agent') };
  }

  private setRefreshCookie(res: HttpResponseLike, token: string): void {
    const maxAge = parseDurationSeconds(this.config.get('REFRESH_TOKEN_TTL'));
    const attrs = [
      `${REFRESH_COOKIE_NAME}=${encodeURIComponent(token)}`,
      `Path=${REFRESH_COOKIE_PATH}`,
      `Max-Age=${maxAge}`,
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
    ];
    res.setHeader('Set-Cookie', attrs.join('; '));
  }

  private readRefreshCookie(req: HttpRequestLike): string | undefined {
    const header = readHeader(req, 'cookie');
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === REFRESH_COOKIE_NAME) {
        return decodeURIComponent(part.slice(eq + 1).trim());
      }
    }
    return undefined;
  }
}
