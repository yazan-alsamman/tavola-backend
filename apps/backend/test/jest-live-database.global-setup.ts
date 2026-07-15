import {
  ensureDatabaseAvailable,
  ensureMinioAvailable,
  isLiveDatabaseRequired,
} from './support/live-database';

export default async function globalSetup(): Promise<void> {
  if (!isLiveDatabaseRequired()) {
    return;
  }

  const available = await ensureDatabaseAvailable();
  if (!available) {
    throw new Error('Live database verification requires PostgreSQL but none is reachable.');
  }

  const minioAvailable = await ensureMinioAvailable();
  if (!minioAvailable) {
    throw new Error('Live database verification requires MinIO but none is reachable.');
  }
}
