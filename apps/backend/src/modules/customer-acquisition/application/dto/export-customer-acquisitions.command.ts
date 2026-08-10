export interface ExportCustomerAcquisitionsCommand {
  from: Date;
  to: Date;
  restaurantId?: string;
  organizationId?: string;
}

export interface ExportCustomerAcquisitionRow {
  id: string;
  restaurantId: string;
  organizationId: string;
  customerIdentityKey: string;
  createdVia: string;
  status: string;
  feeAmount: number;
  feeCurrency: string;
  recordedAt: Date;
  reversedAt: Date | null;
}

export interface ExportCustomerAcquisitionsResult {
  rows: ExportCustomerAcquisitionRow[];
  total: number;
}
