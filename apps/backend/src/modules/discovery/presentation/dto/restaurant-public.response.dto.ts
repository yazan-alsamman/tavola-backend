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
 */
export class RestaurantPublicResponseDto extends RestaurantResponseDto {
  @ApiProperty({ type: [WorkingHoursEntryPublicResponseDto] })
  workingHours!: WorkingHoursEntryPublicResponseDto[];
}
