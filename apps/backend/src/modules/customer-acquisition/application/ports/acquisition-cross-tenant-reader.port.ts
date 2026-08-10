import { RevenueReportGroupBy } from '../dto/get-revenue-report.command';

export interface RevenueReportRawBucket {
  key: string;
  currency: string;
  recordedCount: number;
  recordedTotal: number;
  reversedCount: number;
  reversedTotal: number;
}

export interface ExportAcquisitionRawRow {
  id: string;
  restaurantId: string;
  organizationId: string;
  userId: string | null;
  reservationGuestId: string | null;
  createdVia: string;
  status: string;
  feeAmount: number;
  feeCurrency: string;
  recordedAt: Date;
  reversedAt: Date | null;
}

/**
 * ADR-035 Pattern 2 (Tenant-Agnostic Raw Reader) - genuinely cross-tenant
 * reads with no single `organizationId` to scope by (Revenue Reporting,
 * Export). Per Pattern 2's own DTO requirement (TENANCY.md), this is the
 * Platform Back Office case: every row MUST include `organizationId`/
 * `restaurantId`, the opposite of the three Customer-facing readers that
 * structurally exclude it.
 */
export interface AcquisitionCrossTenantReaderPort {
  groupByRevenue(params: {
    from: Date;
    to: Date;
    groupBy: RevenueReportGroupBy;
    restaurantId?: string;
    organizationId?: string;
  }): Promise<RevenueReportRawBucket[]>;

  exportAcquisitions(params: {
    from: Date;
    to: Date;
    restaurantId?: string;
    organizationId?: string;
  }): Promise<ExportAcquisitionRawRow[]>;
}

export const ACQUISITION_CROSS_TENANT_READER = Symbol('ACQUISITION_CROSS_TENANT_READER');
