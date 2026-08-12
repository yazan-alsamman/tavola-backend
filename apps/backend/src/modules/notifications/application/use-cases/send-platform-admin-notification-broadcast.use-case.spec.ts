import { PlatformAdminNotificationBroadcastRequestedEvent } from '../../domain/events/notification-broadcast.events';
import { SendPlatformAdminNotificationBroadcastUseCase } from './send-platform-admin-notification-broadcast.use-case';

const now = new Date('2026-08-12T12:00:00.000Z');

describe('SendPlatformAdminNotificationBroadcastUseCase', () => {
  it('delegates broadcast creation and publishes the actor-attributed audit event', async () => {
    const createNotificationBroadcast = {
      execute: jest.fn().mockResolvedValue({ broadcastId: 'broadcast-1', totalRecipients: 500 }),
    };
    const eventPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const clock = { now: () => now };
    const idGenerator = { generate: () => 'event-1' };

    const useCase = new SendPlatformAdminNotificationBroadcastUseCase(
      createNotificationBroadcast as never,
      eventPublisher as never,
      clock as never,
      idGenerator as never,
    );

    const result = await useCase.execute({
      adminId: 'admin-1',
      title: 'Title',
      body: 'Body',
      correlationId: 'corr-1',
    });

    expect(result).toEqual({ broadcastId: 'broadcast-1', totalRecipients: 500 });
    expect(createNotificationBroadcast.execute).toHaveBeenCalledWith({
      senderType: 'PlatformAdmin',
      senderId: 'admin-1',
      organizationId: null,
      title: 'Title',
      body: 'Body',
      correlationId: 'corr-1',
    });

    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    const [event] = eventPublisher.publish.mock.calls[0];
    expect(event).toBeInstanceOf(PlatformAdminNotificationBroadcastRequestedEvent);
    expect(event.payload).toMatchObject({
      broadcastId: 'broadcast-1',
      adminId: 'admin-1',
      totalRecipients: 500,
      correlationId: 'corr-1',
    });
  });
});
