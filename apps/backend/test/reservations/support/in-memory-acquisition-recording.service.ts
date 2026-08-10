import {
  RecordAcquisitionOnApprovalCommand,
  RecordAcquisitionOnApprovalResult,
} from '@modules/customer-acquisition/application/dto/record-acquisition-on-approval.command';

/**
 * Phase 19.2 (ADR-033) - a minimal stand-in for
 * `RecordCustomerAcquisitionOnApprovalService` in specs that predate this
 * phase and never exercised acquisition recording. `RecordCustomerAcquisitionOnApprovalService`
 * is a concrete class with 6 of its own repository dependencies, not an
 * interface - this fake is asserted to that type at each call site
 * (`as unknown as RecordCustomerAcquisitionOnApprovalService`) rather than
 * constructed via `new` with real fakes for all 6, since these specs are
 * about Reservation approval/creation, not acquisition recording itself
 * (which has its own dedicated spec coverage).
 */
export class InMemoryAcquisitionRecordingService {
  public readonly calls: RecordAcquisitionOnApprovalCommand[] = [];

  async recordIfEligible(
    command: RecordAcquisitionOnApprovalCommand,
  ): Promise<RecordAcquisitionOnApprovalResult> {
    this.calls.push(command);
    return { recorded: false };
  }
}
