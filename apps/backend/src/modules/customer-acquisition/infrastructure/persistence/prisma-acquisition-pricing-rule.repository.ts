import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { AcquisitionPricingRuleId } from '@shared/domain/value-objects/identifiers.vo';
import { AcquisitionPricingRule } from '../../domain/entities/acquisition-pricing-rule.entity';
import { PricingScopeType } from '../../domain/enums/customer-acquisition.enums';
import { AcquisitionPricingRuleRepository } from '../../domain/repositories/acquisition-pricing-rule.repository';
import { AcquisitionPricingRulePrismaMapper } from './acquisition-pricing-rule.prisma-mapper';

/**
 * `AcquisitionPricingRule` at Platform scope is platform-global reference
 * data (alongside `SubscriptionPlan`); at Organization/Restaurant scope it
 * carries no `organizationId` column either (polymorphic `scopeId`) - not in
 * `DIRECT_TENANT_OWNED_MODELS` at any scope, so `PrismaContext` is a safe
 * passthrough regardless of bound tenant context, mirroring
 * `PrismaSubscriptionPlanRepository`'s own doc comment.
 */
@Injectable()
export class PrismaAcquisitionPricingRuleRepository implements AcquisitionPricingRuleRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findById(id: AcquisitionPricingRuleId): Promise<AcquisitionPricingRule | null> {
    const row = await this.prismaContext.client.acquisitionPricingRule.findUnique({
      where: { id: id.value },
    });
    return row ? AcquisitionPricingRulePrismaMapper.toDomain(row) : null;
  }

  async findActiveCandidates(
    scopeType: PricingScopeType,
    scopeId: string | null,
  ): Promise<AcquisitionPricingRule[]> {
    const rows = await this.prismaContext.client.acquisitionPricingRule.findMany({
      where: { scopeType, scopeId, archivedAt: null },
      orderBy: { effectiveFrom: 'desc' },
    });
    return rows.map(AcquisitionPricingRulePrismaMapper.toDomain);
  }

  async findMany(
    page: number,
    limit: number,
    filters?: { label?: string; id?: string },
  ): Promise<{ items: AcquisitionPricingRule[]; total: number }> {
    const where = {
      ...(filters?.label
        ? { label: { contains: filters.label, mode: 'insensitive' as const } }
        : {}),
      ...(filters?.id ? { id: filters.id } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prismaContext.client.acquisitionPricingRule.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.acquisitionPricingRule.count({ where }),
    ]);
    return { items: rows.map(AcquisitionPricingRulePrismaMapper.toDomain), total };
  }

  async save(rule: AcquisitionPricingRule): Promise<void> {
    const data = AcquisitionPricingRulePrismaMapper.toPersistence(rule);
    await this.prismaContext.client.acquisitionPricingRule.upsert({
      where: { id: data.id },
      create: data,
      update: {
        archivedAt: data.archivedAt,
        updatedAt: data.updatedAt,
      },
    });
  }
}
