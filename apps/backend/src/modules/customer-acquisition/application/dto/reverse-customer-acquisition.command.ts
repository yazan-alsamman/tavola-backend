export interface ReverseCustomerAcquisitionCommand {
  acquisitionId: string;
  reason: string;
  actorId: string;
  correlationId?: string;
}
