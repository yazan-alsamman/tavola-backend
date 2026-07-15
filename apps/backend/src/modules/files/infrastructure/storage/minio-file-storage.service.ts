import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import type { StorageConfig } from '@config/storage.config';
import { MINIO_CLIENT } from '@infrastructure/minio/minio-client.provider';
import { StoragePort, UploadObjectInput } from '../../application/ports/storage.port';

@Injectable()
export class MinioFileStorageService implements StoragePort {
  private readonly defaultExpirySeconds: number;
  /**
   * A presigned URL's signature covers the Host header, so it must be
   * signed with the endpoint the *caller* will actually use - never the
   * internal-only endpoint (e.g. Docker Compose's `minio` service name)
   * this process itself uses to reach MinIO for upload/delete. A second
   * client, constructed purely for presigning against
   * StorageConfig.publicEndpoint/publicPort/publicUseSSL, is the only
   * correct way to get both right (falls back to the same values as the
   * injected client when no public override is configured).
   */
  private readonly presigningClient: MinioClient;

  constructor(
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
    configService: ConfigService,
  ) {
    const storageConfig = configService.getOrThrow<StorageConfig>('storage');
    this.defaultExpirySeconds = storageConfig.signedUrlExpirySeconds;
    this.presigningClient = new MinioClient({
      endPoint: storageConfig.publicEndpoint,
      port: storageConfig.publicPort,
      useSSL: storageConfig.publicUseSSL,
      accessKey: storageConfig.accessKey,
      secretKey: storageConfig.secretKey,
      // Required: without an explicit region, the SDK falls back to a
      // network call to auto-detect it, which would try to dial
      // publicEndpoint - often unreachable from wherever this process
      // itself runs (e.g. a container using its own loopback for
      // "localhost"). See MINIO_REGION's comment in env.validation.ts.
      region: storageConfig.region,
    });
  }

  async upload(input: UploadObjectInput): Promise<void> {
    await this.minioClient.putObject(input.bucket, input.objectKey, input.body, input.sizeBytes, {
      'Content-Type': input.contentType,
    });
  }

  async delete(bucket: string, objectKey: string): Promise<void> {
    await this.minioClient.removeObject(bucket, objectKey);
  }

  async getSignedReadUrl(
    bucket: string,
    objectKey: string,
    expirySeconds?: number,
  ): Promise<string> {
    return this.presigningClient.presignedGetObject(
      bucket,
      objectKey,
      expirySeconds ?? this.defaultExpirySeconds,
    );
  }
}
