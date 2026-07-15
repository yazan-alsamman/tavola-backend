import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { FileId } from '@shared/domain/value-objects/identifiers.vo';
import { FileRepository } from '../../domain/repositories/file.repository';
import { FileRecord } from '../../domain/entities/file-record.entity';
import { FilePrismaMapper } from './file.prisma-mapper';

@Injectable()
export class PrismaFileRepository implements FileRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async create(file: FileRecord): Promise<void> {
    const data = FilePrismaMapper.toPersistence(file);
    await this.prismaContext.client.file.create({ data });
  }

  async findById(id: FileId): Promise<FileRecord | null> {
    const row = await this.prismaContext.client.file.findUnique({
      where: { id: id.value },
    });
    return row ? FilePrismaMapper.toDomain(row) : null;
  }

  async softDelete(id: FileId, at: Date): Promise<void> {
    await this.prismaContext.client.file.updateMany({
      where: { id: id.value, deletedAt: null },
      data: { deletedAt: at },
    });
  }
}
