import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MINIO_CLIENT, createMinioClient } from './minio-client.provider';

/**
 * Connects the MinIO client only. Bucket-policy setup, signed-URL
 * generation, and upload/delete operations belong to FileStorageService -
 * the Domain-port implementation ("provider" in the DDD sense) explicitly
 * excluded from Foundation per the Files module being out of scope.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MINIO_CLIENT,
      inject: [ConfigService],
      useFactory: createMinioClient,
    },
  ],
  exports: [MINIO_CLIENT],
})
export class StorageModule {}
