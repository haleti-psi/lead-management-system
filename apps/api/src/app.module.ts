import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// Root module. The Stage-7 foundation wave (architecture §12) registers core/ infra
// (ConfigModule, Db/UnitOfWork, Auth, Audit, Outbox, Integration, Sla, ...) and one
// feature module per BRD module (M1–M15) under src/modules/. Keep cross-module access
// through services (owner-writes §11) — never re-implement core/ utilities.
@Module({
  imports: [],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
