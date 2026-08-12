import { Injectable, Inject } from '@nestjs/common';
import { CustomerAcquisitionId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CustomerAcquisitionRepository,
  CUSTOMER_ACQUISITION_REPOSITORY,
} from '../../domain/repositories/customer-acquisition.repository';
import { CustomerAcquisitionNotFoundException } from '../../domain/exceptions/customer-acquisition-not-found.exception';
import { CustomerAcquisitionResult } from '../dto/customer-acquisition.result';
import { toCustomerAcquisitionResult } from '../mappers/customer-acquisition-result.mapper';

/**
 * ADR-034 §13 — narrow, per-entity lookup ("Acquisition... by name/id");
 * `CustomerAcquisition` has no name/text field (schema.prisma), so `id` is
 * the only applicable axis. Reuses `CustomerAcquisitionRepository.findById`
 * verbatim - the exact same first step `ReverseCustomerAcquisitionUseCase`/
 * `ManuallyRecordCustomerAcquisitionUseCase` already take. `CustomerAcquisition`
 * is not in `DIRECT_TENANT_OWNED_MODELS` (transitively tenant-owned only via
 * `restaurantId -> Restaurant.organizationId`), so this read works with no
 * Tenant Context bound - no Pattern 1/2 classification needed for a plain
 * by-id read, mirroring the two use cases above. Read-only, available to
 * both Platform tiers (ADR-034 §11).
 */
@Injectable()
export class GetCustomerAcquisitionUseCase {
  constructor(
    @Inject(CUSTOMER_ACQUISITION_REPOSITORY)
    private readonly acquisitionRepository: CustomerAcquisitionRepository,
  ) {}

  async execute(acquisitionId: string): Promise<CustomerAcquisitionResult> {
    const acquisition = await this.acquisitionRepository.findById(
      CustomerAcquisitionId.create(acquisitionId),
    );
    if (acquisition === null) {
      throw new CustomerAcquisitionNotFoundException();
    }
    return toCustomerAcquisitionResult(acquisition);
  }
}
