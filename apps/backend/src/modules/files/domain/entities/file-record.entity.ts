import { Entity } from '@shared/domain/base/entity.base';
import { FileId } from '@shared/domain/value-objects/identifiers.vo';

export type FileOwnerType = 'User' | 'Restaurant' | 'Review' | 'Menu' | 'Message';
export type FileAccessPolicy = 'Public' | 'Private';

export interface FileRecordProps {
  id: string;
  ownerId: string;
  ownerType: FileOwnerType;
  bucket: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  accessPolicy: FileAccessPolicy;
  createdAt: Date;
  deletedAt: Date | null;
}

/**
 * Named FileRecord (not File) to avoid colliding with the global DOM `File`
 * type. Mirrors DATABASE_SCHEMA.md's "Files" section field-for-field -
 * metadata only, the actual bytes live in MinIO (DOMAIN_MODEL.md invariant
 * "Every uploaded file has an owner and access policy").
 */
export class FileRecord extends Entity<FileRecordProps> {
  private constructor(props: FileRecordProps) {
    super(props);
  }

  static create(props: FileRecordProps): FileRecord {
    if (props.ownerId.trim().length === 0) {
      throw new Error('FileRecord must have an ownerId.');
    }
    if (props.objectKey.trim().length === 0) {
      throw new Error('FileRecord must have an objectKey.');
    }
    if (props.sizeBytes <= 0) {
      throw new Error('FileRecord sizeBytes must be positive.');
    }
    return new FileRecord({ ...props });
  }

  static reconstitute(props: FileRecordProps): FileRecord {
    return new FileRecord({ ...props });
  }

  get fileId(): FileId {
    return FileId.create(this.props.id);
  }

  get ownerId(): string {
    return this.props.ownerId;
  }

  get ownerType(): FileOwnerType {
    return this.props.ownerType;
  }

  get bucket(): string {
    return this.props.bucket;
  }

  get objectKey(): string {
    return this.props.objectKey;
  }

  get mimeType(): string {
    return this.props.mimeType;
  }

  get sizeBytes(): number {
    return this.props.sizeBytes;
  }

  get accessPolicy(): FileAccessPolicy {
    return this.props.accessPolicy;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt ? new Date(this.props.deletedAt.getTime()) : null;
  }

  isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  softDelete(at: Date): FileRecord {
    return FileRecord.reconstitute({ ...this.props, deletedAt: at });
  }

  toProps(): Readonly<FileRecordProps> {
    return { ...this.props };
  }
}
