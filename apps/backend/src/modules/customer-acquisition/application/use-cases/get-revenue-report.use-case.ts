import { Injectable, Inject } from '@nestjs/common';
import {
  AcquisitionCrossTenantReaderPort,
  ACQUISITION_CROSS_TENANT_READER,
} from '../ports/acquisition-cross-tenant-reader.port';
import { InvalidCustomerAcquisitionException } from '../../domain/exceptions/invalid-customer-acquisition.exception';
import { GetRevenueReportCommand, GetRevenueReportResult } from '../dto/get-revenue-report.command';

/**
 * ADR-033 §22/§24 - "Recorded"/"Reversed" metrics only, never "Collected"/
 * "Outstanding" (TAVLA never observes payment state). One flexible,
 * parameterized read surface (`groupBy`) rather than a fixed endpoint per
 * report type, matching ADR-028's own established Analytics query shape.
 * ADR-035 Pattern 2 - reads across every Restaurant/Organization at once.
 */
@Injectable()
export class GetRevenueReportUseCase {
  constructor(
    @Inject(ACQUISITION_CROSS_TENANT_READER)
    private readonly reader: AcquisitionCrossTenantReaderPort,
  ) {}

  async execute(command: GetRevenueReportCommand): Promise<GetRevenueReportResult> {
    if (command.from.getTime() >= command.to.getTime()) {
      throw new InvalidCustomerAcquisitionException('from must be strictly before to.');
    }

    const buckets = await this.reader.groupByRevenue({
      from: command.from,
      to: command.to,
      groupBy: command.groupBy,
      restaurantId: command.restaurantId,
      organizationId: command.organizationId,
    });

    return {
      groupBy: command.groupBy,
      buckets: buckets.map((bucket) => ({
        key: bucket.key,
        currency: bucket.currency,
        recordedCount: bucket.recordedCount,
        recordedTotal: bucket.recordedTotal,
        reversedCount: bucket.reversedCount,
        reversedTotal: bucket.reversedTotal,
      })),
    };
  }
}
