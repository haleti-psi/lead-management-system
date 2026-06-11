import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // /health stays unprefixed for Cloud Run; everything else is under /api/v1.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  // Stage-7 foundation wave (architecture §12) wires here: helmet, CORS (ALLOWED_ORIGINS),
  // global JwtAuthGuard + AbacGuard, ResponseEnvelopeInterceptor, AllExceptionsFilter,
  // CorrelationMiddleware, and Zod-validated config (core/config).
  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
