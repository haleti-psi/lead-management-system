import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Module } from '@nestjs/common';
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
 */
@Module({
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
})
export class LoggingModule {}
