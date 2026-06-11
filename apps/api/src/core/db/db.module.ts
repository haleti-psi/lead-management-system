import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';

import { AppConfigService } from '../config';
import { KYSELY, createKysely, type KyselyDb } from './database';
import { UnitOfWork } from './unit-of-work';

/**
 * Global database module. Provides the single {@link KYSELY} instance (pg Pool +
 * Kysely) and the {@link UnitOfWork} ambient transaction. Relies on the global
 * `ClsModule` (registered in AppModule) for request-scoped transaction storage.
 * Closes the pool on shutdown so Cloud Run instances drain cleanly.
 */
@Global()
@Module({
  providers: [
    {
      provide: KYSELY,
      useFactory: (config: AppConfigService): KyselyDb => createKysely(config),
      inject: [AppConfigService],
    },
    UnitOfWork,
  ],
  exports: [KYSELY, UnitOfWork],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
