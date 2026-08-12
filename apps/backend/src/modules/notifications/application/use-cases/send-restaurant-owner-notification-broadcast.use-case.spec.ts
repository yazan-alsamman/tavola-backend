import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { RestaurantOwnerNotificationBroadcastRequestedEvent } from '../../domain/events/notification-broadcast.events';
import { SendRestaurantOwnerNotificationBroadcastUseCase } from './send-restaurant-owner-notification-broadcast.use-case';

const now = new Date('2026-08-12T12:00:00.000Z');
const restaurantId = '11111111-1111-4111-8111-111111111111';

function build(restaurantFound: boolean) {
  const createNotificationBroadcast = {
    execute: jest.fn().mockResolvedValue({ broadcastId: 'broadcast-1', totalRecipients: 500 }),
  };
  const restaurantRepository = {
    findById: jest.fn().mockResolvedValue(restaurantFound ? { restaurantId: { value: restaurantId } } : null),
  };
  const eventPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
  const clock = { now: () => now };
  const idGenerator = { generate: () => 'event-1' };

  const useCase = new SendRestaurantOwnerNotificationBroadcastUseCase(
    createNotificationBroadcast as never,
    restaurantRepository as never,
    eventPublisher as never,
    clock as never,
    idGenerator as never,
  );
  return { useCase, createNotificationBroadcast, restaurantRepository, eventPublisher };
}

describe('SendRestaurantOwnerNotificationBroadcastUseCase', () => {
  it('throws RestaurantNotFoundException (IDOR-safe) when the restaurant does not resolve for the caller (cross-org or nonexistent)', async () => {
    const { useCase, createNotificationBroadcast } = build(false);

    await expect(
      useCase.execute({
        ownerId: 'owner-1',
        organizationId: 'org-1',
        restaurantId,
        title: 'Title',
        body: 'Body',
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    expect(createNotificationBroadcast.execute).not.toHaveBeenCalled();
  });

  it('delegates broadcast creation with OrganizationMember sender fields and publishes the audit event, never narrowing the audience by restaurantId', async () => {
    const { useCase, createNotificationBroadcast, eventPublisher } = build(true);

    const result = await useCase.execute({
      ownerId: 'owner-1',
      organizationId: 'org-1',
      restaurantId,
      title: 'Title',
      body: 'Body',
      correlationId: 'corr-1',
    });

    expect(result).toEqual({ broadcastId: 'broadcast-1', totalRecipients: 500 });
    expect(createNotificationBroadcast.execute).toHaveBeenCalledWith({
      senderType: 'OrganizationMember',
      senderId: 'owner-1',
      organizationId: 'org-1',
      title: 'Title',
      body: 'Body',
      correlationId: 'corr-1',
    });

    const [event] = eventPublisher.publish.mock.calls[0];
    expect(event).toBeInstanceOf(RestaurantOwnerNotificationBroadcastRequestedEvent);
    expect(event.payload).toMatchObject({
      broadcastId: 'broadcast-1',
      ownerId: 'owner-1',
      organizationId: 'org-1',
      restaurantId,
    });
  });
});
