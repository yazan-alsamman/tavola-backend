import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { PrismaFileRepository } from './infrastructure/persistence/prisma-file.repository';
import { MinioFileStorageService } from './infrastructure/storage/minio-file-storage.service';
import { FILE_REPOSITORY } from './domain/repositories/file.repository';
import { STORAGE_PORT } from './application/ports/storage.port';

/**
 * Phase 3.2 (Avatar Upload). Provides the Files aggregate's persistence port
 * and the object-storage port on top of the process-wide MINIO_CLIENT that
 * StorageModule (@Global()) already wires - no second MinIO client, per that
 * module's own doc-comment naming FileStorageService as the intended owner
 * of upload/delete/signed-URL operations.
 */
@Module({
  imports: [PrismaModule, ConfigModule],
  providers: [
    PrismaFileRepository,
    MinioFileStorageService,
    { provide: FILE_REPOSITORY, useExisting: PrismaFileRepository },
    { provide: STORAGE_PORT, useExisting: MinioFileStorageService },
  ],
  exports: [FILE_REPOSITORY, STORAGE_PORT],
})
export class FilesModule {}
