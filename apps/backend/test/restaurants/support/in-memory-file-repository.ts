import { FileRepository } from '@modules/files/domain/repositories/file.repository';
import { FileRecord } from '@modules/files/domain/entities/file-record.entity';
import { FileId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryFileRepository implements FileRepository {
  private readonly files = new Map<string, FileRecord>();

  async create(file: FileRecord): Promise<void> {
    this.files.set(file.fileId.value, file);
  }

  async findById(id: FileId): Promise<FileRecord | null> {
    return this.files.get(id.value) ?? null;
  }

  async findManyByIds(ids: FileId[]): Promise<FileRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const uniqueIds = [...new Set(ids.map((id) => id.value))];
    return uniqueIds
      .map((id) => this.files.get(id))
      .filter((file): file is FileRecord => file !== undefined);
  }

  async softDelete(id: FileId, at: Date): Promise<void> {
    const existing = this.files.get(id.value);
    if (existing) {
      this.files.set(id.value, existing.softDelete(at));
    }
  }

  seed(file: FileRecord): void {
    this.files.set(file.fileId.value, file);
  }

  get(id: string): FileRecord | undefined {
    return this.files.get(id);
  }
}
