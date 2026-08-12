import { GetCustomerAcquisitionUseCase } from './get-customer-acquisition.use-case';
import { CustomerAcquisitionRepository } from '../../domain/repositories/customer-acquisition.repository';
import { CustomerAcquisition } from '../../domain/entities/customer-acquisition.entity';
import { CustomerAcquisitionNotFoundException } from '../../domain/exceptions/customer-acquisition-not-found.exception';
import {
  AcquisitionCreatedVia,
  AcquisitionStatus,
} from '../../domain/enums/customer-acquisition.enums';

const ACQUISITION_ID = '11111111-1111-4111-8111-111111111111';

function buildAcquisition(): CustomerAcquisition {
  return CustomerAcquisition.reconstitute({
    id: ACQUISITION_ID,
    restaurantId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
    reservationGuestId: null,
    sourceReservationId: null,
    reservationSource: null,
    createdVia: AcquisitionCreatedVia.Automatic,
    status: AcquisitionStatus.Recorded,
    feeAmount: 1000,
    feeCurrency: 'SYP',
    pricingRuleId: '44444444-4444-4444-8444-444444444444',
    recordedAt: new Date('2026-08-01T00:00:00.000Z'),
    reversedAt: null,
    reversedBy: null,
    reversalReason: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  });
}

class FakeRepository implements CustomerAcquisitionRepository {
  constructor(private readonly row: CustomerAcquisition | null) {}
  async findById() {
    return this.row;
  }
  async findActiveByRestaurantAndIdentity() {
    return null;
  }
  async findManyByRestaurantId() {
    return { items: [], total: 0 };
  }
  async countRecordedInWindow() {
    return 0;
  }
  async createIfNotExists() {
    return true;
  }
  async save() {}
}

describe('GetCustomerAcquisitionUseCase', () => {
  it('returns the mapped result when found', async () => {
    const useCase = new GetCustomerAcquisitionUseCase(new FakeRepository(buildAcquisition()));

    const result = await useCase.execute(ACQUISITION_ID);

    expect(result.id).toBe(ACQUISITION_ID);
    expect(result.feeAmount).toBe(1000);
    expect(result.feeCurrency).toBe('SYP');
  });

  it('throws CustomerAcquisitionNotFoundException when not found', async () => {
    const useCase = new GetCustomerAcquisitionUseCase(new FakeRepository(null));

    await expect(useCase.execute(ACQUISITION_ID)).rejects.toBeInstanceOf(
      CustomerAcquisitionNotFoundException,
    );
  });
});
