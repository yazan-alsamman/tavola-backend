import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  PlatformAdminRestaurantLookupReaderPort,
  PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER,
} from '@modules/restaurants/application/ports/platform-admin-restaurant-lookup-reader.port';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  CustomerAcquisitionRepository,
  CUSTOMER_ACQUISITION_REPOSITORY,
} from '../../domain/repositories/customer-acquisition.repository';
import { CustomerAcquisitionResult } from '../dto/customer-acquisition.result';
import { toCustomerAcquisitionResult } from '../mappers/customer-acquisition-result.mapper';

export interface ListCustomerAcquisitionsQuery {
  restaurantId: string;
  page: number;
  limit: number;
}

export interface ListCustomerAcquisitionsResult {
  items: CustomerAcquisitionResult[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Read-only, single-restaurant scope - available to both PlatformAdmin and
 * PlatformSupport (ADR-034 §11). No Tenant Context rebind: reads carry no
 * audit obligation (TENANCY.md Pattern 2's own "Audit: none required" rule),
 * and `CustomerAcquisition` is not in `DIRECT_TENANT_OWNED_MODELS` - the
 * lookup call below exists only to turn an unknown restaurantId into a
 * proper 404 rather than a silently-empty list.
 */
@Injectable()
export class ListCustomerAcquisitionsUseCase {
  constructor(
    @Inject(CUSTOMER_ACQUISITION_REPOSITORY)
    private readonly acquisitionRepository: CustomerAcquisitionRepository,
    @Inject(PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER)
    private readonly restaurantLookupReader: PlatformAdminRestaurantLookupReaderPort,
  ) {}

  async execute(query: ListCustomerAcquisitionsQuery): Promise<ListCustomerAcquisitionsResult> {
    const lookup = await this.restaurantLookupReader.findOrganizationIdByRestaurantId(
      query.restaurantId,
    );
    if (lookup === null) {
      throw new RestaurantNotFoundException();
    }

    const { items, total } = await this.acquisitionRepository.findManyByRestaurantId(
      RestaurantId.create(query.restaurantId),
      query.page,
      query.limit,
    );
    return {
      items: items.map(toCustomerAcquisitionResult),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}
