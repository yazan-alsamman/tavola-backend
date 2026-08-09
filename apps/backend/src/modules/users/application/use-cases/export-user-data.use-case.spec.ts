import { ExportUserDataUseCase } from './export-user-data.use-case';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { UserDataExportRequestedEvent } from '@modules/authentication/domain/events/authentication.events';
import { GetCurrentUserProfileUseCase } from './get-current-user-profile.use-case';
import { GetCurrentUserPreferencesUseCase } from './get-current-user-preferences.use-case';
import { ListCurrentUserFavoritesUseCase } from './list-current-user-favorites.use-case';
import { ListMyReservationsUseCase } from '@modules/reservations/application/use-cases/list-my-reservations.use-case';
import { ListMyReviewsUseCase } from '@modules/reviews/application/use-cases/list-my-reviews.use-case';
import {
  CollectingEventPublisher,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('ExportUserDataUseCase', () => {
  const now = new Date('2026-08-07T12:00:00.000Z');
  const actor = {
    actorType: AccessTokenActorType.User as const,
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: 's1',
    sessionVersion: 1,
    tokenFamilyId: 'f1',
  };

  function build() {
    const profileExecute = jest.fn();
    const preferencesExecute = jest.fn();
    const favoritesExecute = jest.fn();
    const reservationsExecute = jest.fn();
    const reviewsExecute = jest.fn();
    const eventPublisher = new CollectingEventPublisher();

    const useCase = new ExportUserDataUseCase(
      { execute: profileExecute } as unknown as GetCurrentUserProfileUseCase,
      { execute: preferencesExecute } as unknown as GetCurrentUserPreferencesUseCase,
      { execute: favoritesExecute } as unknown as ListCurrentUserFavoritesUseCase,
      { execute: reservationsExecute } as unknown as ListMyReservationsUseCase,
      { execute: reviewsExecute } as unknown as ListMyReviewsUseCase,
      eventPublisher,
      new FixedClock(now),
      new SequentialIdGenerator(['eeeeeeee-1111-4111-8111-111111111111']),
    );

    return {
      useCase,
      profileExecute,
      preferencesExecute,
      favoritesExecute,
      reservationsExecute,
      reviewsExecute,
      eventPublisher,
    };
  }

  it('composes Profile/Preferences/Favorites/Reservations/Reviews from their own existing use cases, each scoped to the caller only', async () => {
    const {
      useCase,
      profileExecute,
      preferencesExecute,
      favoritesExecute,
      reservationsExecute,
      reviewsExecute,
    } = build();
    profileExecute.mockResolvedValue({ userId: actor.userId, firstName: 'Jane' });
    preferencesExecute.mockResolvedValue({ userId: actor.userId, notificationOptIn: true });
    favoritesExecute.mockResolvedValue({
      items: [{ restaurantId: 'r1' }],
      page: 1,
      limit: 1000,
      total: 1,
    });
    reservationsExecute.mockResolvedValue({
      items: [{ reservationId: 'res1' }],
      page: 1,
      limit: 1000,
      total: 1,
    });
    reviewsExecute.mockResolvedValue({
      items: [{ reviewId: 'rev1' }],
      page: 1,
      limit: 1000,
      total: 1,
    });

    const result = await useCase.execute({ actor });

    expect(profileExecute).toHaveBeenCalledWith({ actor });
    expect(preferencesExecute).toHaveBeenCalledWith({ actor });
    expect(favoritesExecute).toHaveBeenCalledWith({ actor, page: 1, limit: 1000 });
    expect(reservationsExecute).toHaveBeenCalledWith({ actor, page: 1, limit: 1000 });
    expect(reviewsExecute).toHaveBeenCalledWith({ actor, page: 1, limit: 1000 });
    expect(result.exportedAt).toEqual(now);
    expect(result.profile).toEqual({ userId: actor.userId, firstName: 'Jane' });
    expect(result.favorites).toEqual({ items: [{ restaurantId: 'r1' }], total: 1 });
    expect(result.reservations).toEqual({ items: [{ reservationId: 'res1' }], total: 1 });
    expect(result.reviews).toEqual({ items: [{ reviewId: 'rev1' }], total: 1 });
  });

  it('publishes UserDataExportRequestedEvent - the one read-flow event in this codebase', async () => {
    const {
      useCase,
      profileExecute,
      preferencesExecute,
      favoritesExecute,
      reservationsExecute,
      reviewsExecute,
      eventPublisher,
    } = build();
    profileExecute.mockResolvedValue({});
    preferencesExecute.mockResolvedValue({});
    favoritesExecute.mockResolvedValue({ items: [], page: 1, limit: 1000, total: 0 });
    reservationsExecute.mockResolvedValue({ items: [], page: 1, limit: 1000, total: 0 });
    reviewsExecute.mockResolvedValue({ items: [], page: 1, limit: 1000, total: 0 });

    await useCase.execute({ actor, correlationId: 'corr-export-1' });

    const event = eventPublisher.events[0] as UserDataExportRequestedEvent;
    expect(event).toBeInstanceOf(UserDataExportRequestedEvent);
    expect(event.payload).toEqual({ userId: actor.userId });
    expect(event.correlationId).toBe('corr-export-1');
  });
});
