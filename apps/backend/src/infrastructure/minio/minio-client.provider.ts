import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import type { StorageConfig } from '@config/storage.config';

export const MINIO_CLIENT = Symbol('MINIO_CLIENT');

export function createMinioClient(configService: ConfigService): MinioClient {
  const storageConfig = configService.getOrThrow<StorageConfig>('storage');

  return new MinioClient({
    endPoint: storageConfig.endpoint,
    port: storageConfig.port,
    useSSL: storageConfig.useSSL,
    accessKey: storageConfig.accessKey,
    secretKey: storageConfig.secretKey,
    region: storageConfig.region,
  });
}
