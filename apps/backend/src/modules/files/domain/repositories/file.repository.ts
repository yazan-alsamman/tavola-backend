import { FileId } from '@shared/domain/value-objects/identifiers.vo';
import { FileRecord } from '../entities/file-record.entity';

export interface FileRepository {
  create(file: FileRecord): Promise<void>;
  findById(id: FileId): Promise<FileRecord | null>;
  softDelete(id: FileId, at: Date): Promise<void>;
}

export const FILE_REPOSITORY = Symbol('FILE_REPOSITORY');
