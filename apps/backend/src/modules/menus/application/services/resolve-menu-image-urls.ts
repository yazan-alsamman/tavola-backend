import { FileId } from '@shared/domain/value-objects/identifiers.vo';
import { FileRepository } from '@modules/files/domain/repositories/file.repository';
import { StoragePort } from '@modules/files/application/ports/storage.port';

/**
 * ADR-031 decision #5: "Signed read URLs are resolved at read time and
 * never persisted." Batches every distinct, non-null `imageFileId` across a
 * full Menu tree into one `findManyByIds` call (Phase 15 precedent) instead
 * of one lookup per Category/Item, then resolves one signed URL per file -
 * MinIO's presign operation is local/cryptographic (no network round trip
 * per call), so this is not itself a further batching concern.
 */
export async function resolveMenuImageUrls(
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
