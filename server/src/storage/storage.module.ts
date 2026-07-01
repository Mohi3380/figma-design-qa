import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { LocalStorage } from './local-storage.service';
import { S3Storage } from './s3-storage.service';

/**
 * Picks the storage backend from STORAGE_DRIVER (`s3` | `local`, default
 * `local`). Global so any module can inject StorageService without re-importing.
 */
@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      useFactory: (config: ConfigService): StorageService =>
        config.get<string>('STORAGE_DRIVER') === 's3' ? new S3Storage(config) : new LocalStorage(config),
      inject: [ConfigService],
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
