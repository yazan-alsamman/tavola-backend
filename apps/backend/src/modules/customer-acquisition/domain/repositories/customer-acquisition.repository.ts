import { CustomerAcquisitionId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { CustomerAcquisition } from '../entities/customer-acquisition.entity';

export interface CustomerAcquisitionRepository {
  findById(id: CustomerAcquisitionId): Promise<CustomerAcquisition | null>;

  /**
   * ADR-033 §9 - the authoritative concurrency check. `null` means no
   * active (non-Reversed) acquisition currently exists for this
   * (Restaurant, Customer-Identity) pair.
   */
  findActiveByRestaurantAndIdentity(
    restaurantId: RestaurantId,
    userId: string | null,
    reservationGuestId: string | null,
  ): Promise<CustomerAcquisition | null>;

  findManyByRestaurantId(
    restaurantId: RestaurantId,
    page: number,
    limit: number,
  ): Promise<{ items: CustomerAcquisition[]; total: number }>;

  /** ADR-033 §19 (Pricing Simulation) - count of Recorded acquisitions in `[from, to)` for one Restaurant. */
  countRecordedInWindow(restaurantId: RestaurantId, from: Date, to: Date): Promise<number>;

  /**
   * ADR-033 §9 - atomic insert-if-not-exists: the partial unique index is
   * the actual concurrency authority, not this check-then-insert call
   * itself. Returns `false` (no-op, already acquired) on a unique-violation
   * instead of throwing - the caller treats that as "nothing to do", never
   * as an error.
   */
  createIfNotExists(acquisition: CustomerAcquisition): Promise<boolean>;

  save(acquisition: CustomerAcquisition): Promise<void>;
}

export const CUSTOMER_ACQUISITION_REPOSITORY = Symbol('CUSTOMER_ACQUISITION_REPOSITORY');
