import { Module } from '@nestjs/common';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { BranchesModule } from '@modules/branches/branches.module';
import { TablesModule } from '@modules/tables/tables.module';
import { SearchAvailabilityUseCase } from './application/use-cases/search-availability.use-case';
import { CreateReservationUseCase } from './application/use-cases/create-reservation.use-case';
import { RESERVATION_REPOSITORY } from './domain/repositories/reservation.repository';
import { PrismaReservationRepository } from './infrastructure/persistence/prisma-reservation.repository';
import { ReservationsController } from './presentation/controllers/reservations.controller';

/**
 * Phase 7.1 (Reservation Core) - TASKS.md Phase 7.1 Scope Amendment
 * (2026-07-20): Search Availability + Create Reservation only. Customer-facing
 * (`JwtAuthGuard`/`SessionVersionGuard` only, no organization/employee guard -
 * see `ReservationsController`'s own doc comment). Depends on
 * `RestaurantsModule` for `RESTAURANT_SETTINGS_REPOSITORY`
 * (`reservationEndTime` derivation, advisory-lock time-slot bucketing),
 * `BranchesModule` for `BRANCH_REPOSITORY`, and `TablesModule` for
 * `TABLE_REPOSITORY` - none of `Reservation`/`Branch`/`Table`/
 * `RestaurantSettings` are in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS`, so every dependency here is a safe read for
 * an actor with no `organizationId` (see each repository's own doc comment).
 * `AUDIT_LOG_WRITER` is not listed - `AuditModule` is `@Global()`.
 */
@Module({
  imports: [AuthenticationModule, RestaurantsModule, BranchesModule, TablesModule],
  controllers: [ReservationsController],
  providers: [
    SearchAvailabilityUseCase,
    CreateReservationUseCase,
    PrismaReservationRepository,
    { provide: RESERVATION_REPOSITORY, useExisting: PrismaReservationRepository },
  ],
})
export class ReservationsModule {}
