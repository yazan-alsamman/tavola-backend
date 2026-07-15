import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
  publicBucket: process.env.MINIO_PUBLIC_BUCKET,
  privateBucket: process.env.MINIO_PRIVATE_BUCKET,
  signedUrlExpirySeconds: parseInt(process.env.MINIO_SIGNED_URL_EXPIRY_SECONDS ?? '3600', 10),
  // See MINIO_PUBLIC_ENDPOINT's comment in env.validation.ts - falls back to
  // the internal endpoint/port/useSSL when unset, preserving today's
  // behavior for setups where both are already the same reachable host.
  publicEndpoint: process.env.MINIO_PUBLIC_ENDPOINT ?? process.env.MINIO_ENDPOINT,
  publicPort: parseInt(process.env.MINIO_PUBLIC_PORT ?? process.env.MINIO_PORT ?? '9000', 10),
  publicUseSSL: process.env.MINIO_PUBLIC_USE_SSL
    ? process.env.MINIO_PUBLIC_USE_SSL === 'true'
    : process.env.MINIO_USE_SSL === 'true',
  region: process.env.MINIO_REGION ?? 'us-east-1',
}));

export interface StorageConfig {
  endpoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  publicBucket: string;
  privateBucket: string;
  signedUrlExpirySeconds: number;
  publicEndpoint: string;
  publicPort: number;
  publicUseSSL: boolean;
  region: string;
}
