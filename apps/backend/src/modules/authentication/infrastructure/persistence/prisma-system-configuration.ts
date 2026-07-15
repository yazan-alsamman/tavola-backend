import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { SystemConfigurationPort } from '@shared/application/ports/system-configuration.port';

@Injectable()
export class PrismaSystemConfiguration implements SystemConfigurationPort {
  constructor(private readonly prismaContext: PrismaContext) {}

  async getNumber(key: string, defaultValue: number): Promise<number> {
    const row = await this.prismaContext.client.systemConfiguration.findUnique({
      where: { key },
    });

    if (!row) {
      return defaultValue;
    }

    return this.parseNumber(row.value, defaultValue);
  }

  async getString(key: string, defaultValue: string): Promise<string> {
    const row = await this.prismaContext.client.systemConfiguration.findUnique({
      where: { key },
    });

    if (!row) {
      return defaultValue;
    }

    if (typeof row.value === 'string') {
      return row.value;
    }

    if (typeof row.value === 'number' || typeof row.value === 'boolean') {
      return String(row.value);
    }

    return defaultValue;
  }

  private parseNumber(value: Prisma.JsonValue, defaultValue: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : defaultValue;
    }

    return defaultValue;
  }
}
