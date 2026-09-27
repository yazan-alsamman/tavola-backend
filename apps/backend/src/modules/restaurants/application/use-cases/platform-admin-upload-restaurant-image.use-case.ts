import { Injectable, Inject } from '@nestjs/common';
import {
  TenantContextPort,
  TENANT_CONTEXT_PORT,
} from '@shared/application/ports/tenant-context.port';
import {
  PlatformAdminRestaurantLookupReaderPort,
  PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER,
} from '../ports/platform-admin-restaurant-lookup-reader.port';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { UploadedGalleryImageFile } from '../dto/add-restaurant-gallery-image.command';
import {
  RestaurantImageSlot,
  UploadRestaurantImageResult,
} from '../dto/upload-restaurant-image.command';
import { UploadRestaurantImageUseCase } from './upload-restaurant-image.use-case';

export interface PlatformAdminUploadRestaurantImageCommand {
  restaurantId: string;
  actorId: string;
  slot: RestaurantImageSlot;
  file: UploadedGalleryImageFile | null;
  correlationId?: string;
}

/**
 * Platform Owner console path for the same cover/logo write the Owner route
 * performs. The console has no tenant bound by the interceptor, so this
 * resolves the restaurant cross-tenant, then rebinds to its organization
 * before the tenant-scoped upload runs. A soft-deleted restaurant is rejected.
 */
@Injectable()
export class PlatformAdminUploadRestaurantImageUseCase {
  constructor(
    private readonly uploadRestaurantImageUseCase: UploadRestaurantImageUseCase,
    @Inject(PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER)
    private readonly reader: PlatformAdminRestaurantLookupReaderPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(
    command: PlatformAdminUploadRestaurantImageCommand,
  ): Promise<UploadRestaurantImageResult> {
    const restaurant = await this.reader.findDetailById(command.restaurantId);
    if (restaurant === null || restaurant.deletedAt !== null) {
      throw new RestaurantNotFoundException();
    }

    return this.tenantContext.runAsync(
      {
        organizationId: restaurant.organizationId,
        userId: null,
        correlationId: command.correlationId ?? command.restaurantId,
        actorType: 'PlatformAdmin',
      },
      () =>
        this.uploadRestaurantImageUseCase.execute({
          actorUserId: command.actorId,
          organizationId: restaurant.organizationId,
          restaurantId: command.restaurantId,
          slot: command.slot,
          file: command.file,
          correlationId: command.correlationId,
        }),
    );
  }
}
