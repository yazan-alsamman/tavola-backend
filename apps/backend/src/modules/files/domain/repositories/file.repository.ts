import { FileId } from '@shared/domain/value-objects/identifiers.vo';
import { FileRecord } from '../entities/file-record.entity';

export interface FileRepository {
  create(file: FileRecord): Promise<void>;
  findById(id: FileId): Promise<FileRecord | null>;
  /** Phase 15 (Optimization) batch accessor - order not guaranteed, duplicate/unknown IDs silently omitted. Empty input returns `[]` without a database round-trip. */
  findManyByIds(ids: FileId[]): Promise<FileRecord[]>;
  softDelete(id: FileId, at: Date): Promise<void>;
}

export const FILE_REPOSITORY = Symbol('FILE_REPOSITORY');
