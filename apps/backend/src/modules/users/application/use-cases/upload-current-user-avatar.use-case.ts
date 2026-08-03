import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { UserId, FileId } from '@shared/domain/value-objects/identifiers.vo';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import { UserNotFoundException } from '@modules/authentication/application/exceptions/user-not-found.exception';
import {
  FileRepository,
  FILE_REPOSITORY,
} from '@modules/files/domain/repositories/file.repository';
import { FileRecord } from '@modules/files/domain/entities/file-record.entity';
import { StoragePort, STORAGE_PORT } from '@modules/files/application/ports/storage.port';
import { detectImageMimeType } from '@modules/files/domain/services/image-signature.detector';
import { AVATAR_MAX_SIZE_BYTES, isAllowedAvatarMimeType } from '../policies/avatar-upload.policy';
import { MissingAvatarFileException } from '../exceptions/missing-avatar-file.exception';
import { AvatarFileTooLargeException } from '../exceptions/avatar-file-too-large.exception';
import { UnsupportedAvatarFileTypeException } from '../exceptions/unsupported-avatar-file-type.exception';
import { InvalidAvatarFileException } from '../exceptions/invalid-avatar-file.exception';
import { AvatarStorageUnavailableException } from '../exceptions/avatar-storage-unavailable.exception';
import {
  UploadCurrentUserAvatarCommand,
  UploadedAvatarFile,
} from '../dto/upload-current-user-avatar.command';
import { UploadCurrentUserAvatarResult } from '../dto/upload-current-user-avatar.result';
import { AVATAR_BUCKET } from '../tokens/users.tokens';

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Avatars are stored in the public bucket (accessPolicy 'Public') since they
 * are routinely displayed to other users/staff (reviews, booking lists) and
 * are not sensitive documents - the private bucket is reserved for file
 * types that need per-request authorization, which avatars do not. This is
 * a deliberate scope judgment (docs specify the bucket split but not which
 * bucket avatars use), recorded in the Phase 3.2 report. The access URL
 * returned to clients is still a freshly-generated signed URL (never
 * persisted) rather than a raw public path, so no separate "public base
 * URL" config needs to be invented - MINIO_SIGNED_URL_EXPIRY_SECONDS already
 * exists for this.
 */
const AVATAR_ACCESS_POLICY = 'Public' as const;

@Injectable()
export class UploadCurrentUserAvatarUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
    @Inject(AVATAR_BUCKET) private readonly bucket: string,
  ) {}

  async execute(command: UploadCurrentUserAvatarCommand): Promise<UploadCurrentUserAvatarResult> {
    const userId = UserId.create(command.actor.userId);
    const { file, mimeType: detectedMimeType } = this.validate(command.file);

    const user = await this.userRepository.findById(userId);
    if (user === null) {
      throw new UserNotFoundException();
    }

    const now = this.clock.now();
    const fileId = this.idGenerator.generate();
    const objectKey = `avatars/${userId.value}/${fileId}.${EXTENSION_BY_MIME_TYPE[detectedMimeType]}`;

    await this.uploadOrFail(objectKey, file, detectedMimeType);

    const fileRecord = FileRecord.create({
      id: fileId,
      ownerId: userId.value,
      ownerType: 'User',
      bucket: this.bucket,
      objectKey,
      mimeType: detectedMimeType,
      sizeBytes: file.sizeBytes,
      accessPolicy: AVATAR_ACCESS_POLICY,
      createdAt: now,
      deletedAt: null,
    });

    const previousAvatarId = await this.userRepository.getAvatarId(userId);

    try {
      await this.fileRepository.create(fileRecord);
    } catch (error) {
      await this.compensateUpload(objectKey);
      throw error;
    }

    try {
      await this.userRepository.updateAvatarId(userId, fileId, now);
    } catch (error) {
      await this.fileRepository.softDelete(FileId.create(fileId), now).catch(() => undefined);
      await this.compensateUpload(objectKey);
      throw error;
    }

    if (previousAvatarId !== null && previousAvatarId !== fileId) {
      await this.cleanupOldAvatar(previousAvatarId, now);
    }

    await this.auditLogWriter.record({
      actorId: userId.value,
      actorType: 'User',
      action: 'user.avatar.uploaded',
      targetType: 'User',
      targetId: userId.value,
      organizationId: null,
      correlationId: command.correlationId ?? null,
      ipAddress: command.ipAddress,
      occurredAt: now,
    });

    const avatarUrl = await this.storagePort.getSignedReadUrl(this.bucket, objectKey);

    return {
      avatarId: fileId,
      avatarUrl,
      mimeType: detectedMimeType,
      sizeBytes: file.sizeBytes,
      uploadedAt: now,
    };
  }

  /** Throws on any violation; returns the file plus its verified real MIME type otherwise. */
  private validate(file: UploadedAvatarFile | null): {
    file: UploadedAvatarFile;
    mimeType: string;
  } {
    if (file === null || file.sizeBytes <= 0 || file.buffer.length === 0) {
      throw new MissingAvatarFileException();
    }
    if (file.sizeBytes > AVATAR_MAX_SIZE_BYTES) {
      throw new AvatarFileTooLargeException(AVATAR_MAX_SIZE_BYTES);
    }
    if (!isAllowedAvatarMimeType(file.mimeType)) {
      throw new UnsupportedAvatarFileTypeException(file.mimeType);
    }
    const detected = detectImageMimeType(file.buffer);
    if (detected === null || detected !== file.mimeType) {
      throw new InvalidAvatarFileException();
    }
    return { file, mimeType: detected };
  }

  private async uploadOrFail(
    objectKey: string,
    file: UploadedAvatarFile,
    contentType: string,
  ): Promise<void> {
    try {
      await this.storagePort.upload({
        bucket: this.bucket,
        objectKey,
        body: file.buffer,
        contentType,
        sizeBytes: file.sizeBytes,
      });
    } catch {
      throw new AvatarStorageUnavailableException();
    }
  }

  private async compensateUpload(objectKey: string): Promise<void> {
    try {
      await this.storagePort.delete(this.bucket, objectKey);
    } catch {
      // Best-effort compensation: an orphaned object with no DB reference is
      // never served (nothing points to it) but should be surfaced for ops
      // cleanup rather than crashing a request that already failed.
    }
  }

  private async cleanupOldAvatar(oldFileId: string, at: Date): Promise<void> {
    try {
      const oldFile = await this.fileRepository.findById(FileId.create(oldFileId));
      if (oldFile === null) {
        return;
      }
      await this.storagePort.delete(oldFile.bucket, oldFile.objectKey);
      await this.fileRepository.softDelete(FileId.create(oldFileId), at);
    } catch {
      // Old-object cleanup failure must never corrupt the newly persisted
      // avatar reference - the user's new avatar is already live; the old
      // object/row is left for ops cleanup.
    }
  }
}
