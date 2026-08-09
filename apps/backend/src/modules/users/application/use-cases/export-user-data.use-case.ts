import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UserDataExportRequestedEvent } from '@modules/authentication/domain/events/authentication.events';
import { ListMyReservationsUseCase } from '@modules/reservations/application/use-cases/list-my-reservations.use-case';
import { ListMyReviewsUseCase } from '@modules/reviews/application/use-cases/list-my-reviews.use-case';
import { GetCurrentUserProfileUseCase } from './get-current-user-profile.use-case';
import { GetCurrentUserPreferencesUseCase } from './get-current-user-preferences.use-case';
import { ListCurrentUserFavoritesUseCase } from './list-current-user-favorites.use-case';
import { ExportUserDataCommand } from '../dto/export-user-data.command';
import { ExportUserDataResult } from '../dto/export-user-data.result';

/** MVP scope (documented, see `ExportUserDataResult`'s own doc comment): one page per category. */
const EXPORT_PAGE = 1;
const EXPORT_PAGE_LIMIT = 1000;

/**
 * Phase 20.X (ADR-014 execution) - `GET /users/me/export`, the GDPR
 * right-to-portability use case. Pure composition of already-existing,
 * already-tested per-category use cases - no new data-access/mapping logic.
 * Publishes `UserDataExportRequestedEvent` (the one read-flow event in this
 * codebase, per `EVENTS.md`'s explicit Privacy Events entry) so exporting a
 * customer's full data trove leaves an audit trail like every other
 * privacy-sensitive action, unlike an ordinary `GET`.
 */
@Injectable()
export class ExportUserDataUseCase {
  constructor(
    private readonly getCurrentUserProfileUseCase: GetCurrentUserProfileUseCase,
    private readonly getCurrentUserPreferencesUseCase: GetCurrentUserPreferencesUseCase,
    private readonly listCurrentUserFavoritesUseCase: ListCurrentUserFavoritesUseCase,
    private readonly listMyReservationsUseCase: ListMyReservationsUseCase,
    private readonly listMyReviewsUseCase: ListMyReviewsUseCase,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(command: ExportUserDataCommand): Promise<ExportUserDataResult> {
    const now = this.clock.now();

    const [profile, preferences, favorites, reservations, reviews] = await Promise.all([
      this.getCurrentUserProfileUseCase.execute({ actor: command.actor }),
      this.getCurrentUserPreferencesUseCase.execute({ actor: command.actor }),
      this.listCurrentUserFavoritesUseCase.execute({
        actor: command.actor,
        page: EXPORT_PAGE,
        limit: EXPORT_PAGE_LIMIT,
      }),
      this.listMyReservationsUseCase.execute({
        actor: command.actor,
        page: EXPORT_PAGE,
        limit: EXPORT_PAGE_LIMIT,
      }),
      this.listMyReviewsUseCase.execute({
        actor: command.actor,
        page: EXPORT_PAGE,
        limit: EXPORT_PAGE_LIMIT,
      }),
    ]);

    await this.eventPublisher.publish(
      new UserDataExportRequestedEvent(
        this.idGenerator.generate(),
        { userId: command.actor.userId },
        now,
        command.correlationId,
      ),
    );

    return {
      exportedAt: now,
      profile,
      preferences,
      reservations: { items: reservations.items, total: reservations.total },
      reviews: { items: reviews.items, total: reviews.total },
      favorites: { items: favorites.items, total: favorites.total },
    };
  }
}
