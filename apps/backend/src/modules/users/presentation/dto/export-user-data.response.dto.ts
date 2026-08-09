import { ApiProperty } from '@nestjs/swagger';
import { ReservationResponseDto } from '@modules/reservations/presentation/dto/reservation.response.dto';
import { ReviewResponseDto } from '@modules/reviews/presentation/dto/review.response.dto';
import { UserProfileResponseDto } from './user-profile.response.dto';
import { UserPreferencesResponseDto } from './user-preferences.response.dto';
import { FavoriteListItemResponseDto } from './favorite-list.response.dto';

export class ExportUserReservationsResponseDto {
  @ApiProperty({ type: [ReservationResponseDto] })
  items!: ReservationResponseDto[];

  @ApiProperty({ example: 1 })
  total!: number;
}

export class ExportUserReviewsResponseDto {
  @ApiProperty({ type: [ReviewResponseDto] })
  items!: ReviewResponseDto[];

  @ApiProperty({ example: 1 })
  total!: number;
}

export class ExportUserFavoritesResponseDto {
  @ApiProperty({ type: [FavoriteListItemResponseDto] })
  items!: FavoriteListItemResponseDto[];

  @ApiProperty({ example: 1 })
  total!: number;
}

/**
 * GDPR right-to-portability (ADR-014 §5). Deliberately not a raw dump of
 * every table row this User is referenced from (e.g. AuditLog, DeviceSession) -
 * only the Customer-facing data categories DOMAIN_MODEL.md's "Export User
 * Data" use case exists to cover.
 */
export class ExportUserDataResponseDto {
  @ApiProperty({ format: 'date-time' })
  exportedAt!: string;

  @ApiProperty({ type: UserProfileResponseDto })
  profile!: UserProfileResponseDto;

  @ApiProperty({ type: UserPreferencesResponseDto })
  preferences!: UserPreferencesResponseDto;

  @ApiProperty({ type: ExportUserReservationsResponseDto })
  reservations!: ExportUserReservationsResponseDto;

  @ApiProperty({ type: ExportUserReviewsResponseDto })
  reviews!: ExportUserReviewsResponseDto;

  @ApiProperty({ type: ExportUserFavoritesResponseDto })
  favorites!: ExportUserFavoritesResponseDto;
}
