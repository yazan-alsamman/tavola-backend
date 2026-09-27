import { ApiProperty } from '@nestjs/swagger';
import { RestaurantResponseDto } from '@modules/restaurants/presentation/dto/restaurant.response.dto';
import { WorkingHoursEntryPublicResponseDto } from './working-hours-entry-public.response.dto';

/**
 * Public Working Hours (customer-facing correction). Extends the exact
 * shape `RestaurantsController`'s management endpoints already return
 * (`Restaurant` carries no phone/contact field of its own - see
 * `DATABASE_SCHEMA.md`'s Restaurant section) with `workingHours`, the
 * Restaurant-level default schedule (`WorkingHours`, Phase 4.3). Dedicated
 * Discovery-only DTO, not a field bolted onto the shared
 * `RestaurantResponseDto`, so the private/management detail endpoint's
 * response shape (and its `toResponse` mapper) is untouched - identical
 * reasoning to `FloorPlanPublicResponseDto`/`TablePublicResponseDto` (D11).
 *
 * `coverImageUrl` is Discovery-only for the same reason: the customer app
 * needs a displayable cover, while `coverImageId` keeps its meaning (a bare
 * `File` id) on every surface. See `RestaurantCoverImageUrlResolver`.
 */
export class RestaurantPublicResponseDto extends RestaurantResponseDto {
  @ApiProperty({
    type: String,
    format: 'uri',
    nullable: true,
    example:
      'https://media.example.com/...?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&X-Amz-Signature=...',
    description:
      'Short-lived signed read URL for the cover image identified by `coverImageId`, produced by the API at request time (valid for MINIO_SIGNED_URL_EXPIRY_SECONDS). Use it as-is with a plain HTTP GET and no Authorization header; never construct or cache it past its expiry - re-fetch the restaurant for a fresh one. `null` when `coverImageId` is `null` or the referenced file no longer exists.',
  })
  coverImageUrl!: string | null;

  @ApiProperty({ type: [WorkingHoursEntryPublicResponseDto] })
  workingHours!: WorkingHoursEntryPublicResponseDto[];
}
