import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { AppConfigModule, AppConfigService } from '../config';
import { CORRELATION_HEADER, CORRELATION_ID_KEY } from '../http/correlation.constants';
import { REDACT_PATHS } from './redaction';

/**
 * Structured-logging module (architecture §5/§7). Wraps nestjs-pino:
 * - JSON output (no pretty printing in any deployed environment);
 * - the correlation id is the request id and is bound onto every log line;
 * - auth material and PII are redacted (see {@link REDACT_PATHS}).
 *
 * Pulls the level from validated config (LOG_LEVEL). The correlation id is read
 * from the header set by CorrelationMiddleware (which runs before the handler);
 * if absent at logging time pino assigns one and echoes it on the response.
 *
 * Exposed as a `forRoot()` {@link DynamicModule} — NOT an eager `@Module` — on
 * purpose: nestjs-pino's `LoggerModule.forRootAsync(...)` snapshots the set of
 * `@InjectPinoLogger`-decorated contexts at the instant it is *called*. Calling
 * it inside AppModule's `imports` array defers that snapshot to AppModule
 * evaluation, by which point every feature module (and thus every decorated
 * service, e.g. OutboxService) has been imported. Were it evaluated at file
 * import time, services imported after this file would have no
 * `PinoLogger:<context>` provider and fail dependency resolution at bootstrap.
 */
@Module({})
export class LoggingModule {
  static forRoot(): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRootAsync({
          imports: [AppConfigModule],
          inject: [AppConfigService],
          useFactory: (config: AppConfigService) => ({
            pinoHttp: {
              level: config.get('LOG_LEVEL'),
              redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
              // Use the correlation id as the request id so logs and responses correlate.
              genReqId: (req: IncomingMessage, res: ServerResponse): string => {
                const fromHeader = req.headers[CORRELATION_HEADER];
                const id = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
                const value = id ?? `corr_${randomUUID()}`;
                res.setHeader(CORRELATION_HEADER, value);
                return value;
              },
              customProps: (req: IncomingMessage): Record<string, unknown> => ({
                [CORRELATION_ID_KEY]: (req as IncomingMessage & { id?: string }).id,
                module: 'api',
              }),
              autoLogging: true,
            },
          }),
        }),
      ],
    };
  }
}
