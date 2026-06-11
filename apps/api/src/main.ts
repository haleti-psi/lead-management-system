import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AppConfigService } from './core/config';

async function bootstrap(): Promise<void> {
  // bufferLogs so early boot lines flush through pino once the logger resolves.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Structured pino logger as the application logger (architecture §5/§7).
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);

  // /health stays unprefixed for Cloud Run; everything else is under /api/v1.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  // Security headers (architecture §5).
  app.use(helmet());

  // CORS — explicit allow-list from ALLOWED_ORIGINS, cookie auth (credentials).
  // Never `origin: '*'` with credentials (security.md).
  app.enableCors({
    origin: config.get('ALLOWED_ORIGINS'),
    credentials: true,
  });

  // Drain the pg pool / CLS cleanly on SIGTERM (Cloud Run) — see DbModule.
  app.enableShutdownHooks();

  await app.listen(config.get('PORT'), '0.0.0.0');
}

void bootstrap();
