import { File as PrismaFile } from '@prisma/client';
import { FileRecord } from '../../domain/entities/file-record.entity';
import { FileAccessPolicy, FileOwnerType } from '../../domain/entities/file-record.entity';

export class FilePrismaMapper {
  static toDomain(row: PrismaFile): FileRecord {
    return FileRecord.reconstitute({
      id: row.id,
      ownerId: row.ownerId,
      ownerType: row.ownerType as FileOwnerType,
      bucket: row.bucket,
      objectKey: row.objectKey,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      accessPolicy: row.accessPolicy as FileAccessPolicy,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
    });
  }

  static toPersistence(file: FileRecord): PrismaFile {
    const props = file.toProps();
    return {
      id: props.id,
      ownerId: props.ownerId,
      ownerType: props.ownerType,
      bucket: props.bucket,
      objectKey: props.objectKey,
      mimeType: props.mimeType,
      sizeBytes: props.sizeBytes,
      accessPolicy: props.accessPolicy,
      createdAt: props.createdAt,
      deletedAt: props.deletedAt,
    };
  }
}
