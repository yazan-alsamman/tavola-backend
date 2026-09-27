import { FileId } from '@shared/domain/value-objects/identifiers.vo';
import { FileRepository } from '@modules/files/domain/repositories/file.repository';
import { StoragePort } from '@modules/files/application/ports/storage.port';

/**
 * ADR-031 decision #5: "Signed read URLs are resolved at read time and
 * never persisted." Batches every distinct, non-null file id into one
 * `findManyByIds` call (Phase 15 precedent) instead of one lookup per
 * owning row, then resolves one signed URL per file - MinIO's presign
 * operation is local/cryptographic (no network round trip per call), so
 * this is not itself a further batching concern.
 *
 * An id with no `File` row is simply absent from the returned map; callers
 * render that as a `null` URL (the same rule `ListRestaurantGalleryUseCase`
 * applies), never an error that fails the surrounding read. Originally
 * Menus-only (ADR-031); shared here so Discovery's restaurant cover image
 * reuses the exact same batching/signing path instead of a second copy.
 */
export async function resolveSignedReadUrls(
  fileIds: Array<string | null>,
  fileRepository: FileRepository,
  storagePort: StoragePort,
): Promise<Map<string, string>> {
  const distinctIds = [...new Set(fileIds.filter((id): id is string => id !== null))];
  if (distinctIds.length === 0) {
    return new Map();
  }

  const files = await fileRepository.findManyByIds(distinctIds.map((id) => FileId.create(id)));
  const urlByFileId = new Map<string, string>();
  await Promise.all(
    files.map(async (file) => {
      const url = await storagePort.getSignedReadUrl(file.bucket, file.objectKey);
      urlByFileId.set(file.fileId.value, url);
    }),
  );
  return urlByFileId;
}
