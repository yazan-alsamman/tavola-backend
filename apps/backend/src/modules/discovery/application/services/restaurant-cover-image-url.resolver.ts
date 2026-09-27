import { Injectable, Inject } from '@nestjs/common';
import {
  FileRepository,
  FILE_REPOSITORY,
} from '@modules/files/domain/repositories/file.repository';
import { StoragePort, STORAGE_PORT } from '@modules/files/application/ports/storage.port';
import { resolveSignedReadUrls } from '@modules/files/application/services/resolve-signed-read-urls';

export interface CoverImageOwner {
  coverImageId: string | null;
}

export type WithCoverImageUrl<T> = T & { coverImageUrl: string | null };

/**
 * Turns `Restaurant.coverImageId` (a bare `File` id, unchanged meaning) into
 * the short-lived signed `coverImageUrl` every customer Discovery restaurant
 * projection carries, so a client never needs a file route, bucket, object
 * key, or signing logic of its own.
 *
 * - One batched `findManyByIds` per call regardless of page size (no N+1),
 *   via the shared `resolveSignedReadUrls` path Menus already uses.
 * - Signed through `StoragePort.getSignedReadUrl` with no explicit expiry,
 *   so the configured `MINIO_SIGNED_URL_EXPIRY_SECONDS` TTL and the
 *   `MINIO_PUBLIC_ENDPOINT` host always apply.
 * - Runs in the use case, after `CachingDiscoveryReader`: the cached payload
 *   holds only ids, and every response signs fresh, so a cached entry can
 *   never outlive the URL it would otherwise carry.
 * - `coverImageId: null`, or an id with no `File` row, yields `null` - never
 *   a placeholder, the logo, or a gallery image.
 */
@Injectable()
export class RestaurantCoverImageUrlResolver {
  constructor(
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
  ) {}

  async attach<T extends CoverImageOwner>(restaurants: T[]): Promise<WithCoverImageUrl<T>[]> {
    const urlByFileId = await resolveSignedReadUrls(
      restaurants.map((restaurant) => restaurant.coverImageId),
      this.fileRepository,
      this.storagePort,
    );
    return restaurants.map((restaurant) => ({
      ...restaurant,
      coverImageUrl:
        restaurant.coverImageId === null
          ? null
          : (urlByFileId.get(restaurant.coverImageId) ?? null),
    }));
  }
}
