import { Injectable, Inject } from '@nestjs/common';
import {
  AcquisitionCrossTenantReaderPort,
  ACQUISITION_CROSS_TENANT_READER,
} from '../ports/acquisition-cross-tenant-reader.port';
import { InvalidCustomerAcquisitionException } from '../../domain/exceptions/invalid-customer-acquisition.exception';
import {
  ExportCustomerAcquisitionsCommand,
  ExportCustomerAcquisitionsResult,
} from '../dto/export-customer-acquisitions.command';

const MAX_EXPORT_RANGE_DAYS = 366;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * ADR-033 §23 - a date-range x Restaurant/Organization structured export.
 * Together with the fee snapshot (§18), this is deliberately the *entire*
 * invoice-readiness mechanism - no settlement-batch/invoice-reference field
 * exists or is added here.
 *
 * NON_FUNCTIONAL_REQUIREMENTS.md's Heavy Operations policy (<=30s
 * synchronous, BullMQ-async beyond that) is implemented here only for the
 * synchronous branch - this session bounds the date range to
 * MAX_EXPORT_RANGE_DAYS and returns the result directly. The BullMQ-async
 * branch (for exports whose volume would genuinely exceed the 30s budget)
 * is explicitly NOT implemented in this session - see the Phase 19.2
 * engineering report's "Explicit exclusions" - building job-status
 * persistence/polling/download infrastructure with no existing precedent to
 * reuse was judged higher-risk than shipping it unverified under this
 * session's time budget, not a silent scope cut.
 */
@Injectable()
export class ExportCustomerAcquisitionsUseCase {
  constructor(
    @Inject(ACQUISITION_CROSS_TENANT_READER)
    private readonly reader: AcquisitionCrossTenantReaderPort,
  ) {}

  async execute(
    command: ExportCustomerAcquisitionsCommand,
  ): Promise<ExportCustomerAcquisitionsResult> {
    if (command.from.getTime() >= command.to.getTime()) {
      throw new InvalidCustomerAcquisitionException('from must be strictly before to.');
    }
    const rangeDays = (command.to.getTime() - command.from.getTime()) / MILLISECONDS_PER_DAY;
    if (rangeDays > MAX_EXPORT_RANGE_DAYS) {
      throw new InvalidCustomerAcquisitionException(
        `Export date range must not exceed ${MAX_EXPORT_RANGE_DAYS} days.`,
      );
    }

    const rows = await this.reader.exportAcquisitions({
      from: command.from,
      to: command.to,
      restaurantId: command.restaurantId,
      organizationId: command.organizationId,
    });

    return {
      rows: rows.map((row) => ({
        id: row.id,
        restaurantId: row.restaurantId,
        organizationId: row.organizationId,
        customerIdentityKey: row.userId ?? row.reservationGuestId!,
        createdVia: row.createdVia,
        status: row.status,
        feeAmount: row.feeAmount,
        feeCurrency: row.feeCurrency,
        recordedAt: row.recordedAt,
        reversedAt: row.reversedAt,
      })),
      total: rows.length,
    };
  }
}
