import { NotificationCreatedEvent } from '../../domain/events/notification.events';
import { PlatformAdminNotificationSentEvent } from '../../domain/events/platform-admin-notification-sent.event';
import { CustomerNotFoundException } from '../../domain/exceptions/customer-not-found.exception';
import { SendNotificationToCustomerUseCase } from './send-notification-to-customer.use-case';

const now = new Date('2026-08-12T12:00:00.000Z');
const adminId = '11111111-1111-4111-8111-111111111111';
const targetUserId = '22222222-2222-4222-8222-222222222222';

function build(isEligible: boolean) {
  const customerAudienceReader = { isEligibleCustomer: jest.fn().mockResolvedValue(isEligible) };
  const notificationRepository = { save: jest.fn().mockResolvedValue(undefined) };
  const eventPublisher = { publish: jest.fn(), publishAll: jest.fn().mockResolvedValue(undefined) };
  const clock = { now: () => now };
  let counter = 0;
  const idGenerator = { generate: () => `id-${(counter += 1)}` };

  const useCase = new SendNotificationToCustomerUseCase(
    customerAudienceReader as never,
    notificationRepository as never,
    eventPublisher as never,
    clock as never,
    idGenerator as never,
  );
  return { useCase, customerAudienceReader, notificationRepository, eventPublisher };
}

describe('SendNotificationToCustomerUseCase', () => {
  it('throws CustomerNotFoundException when the target is not an eligible Customer (IDOR-safe)', async () => {
    const { useCase, notificationRepository } = build(false);

    await expect(
      useCase.execute({ adminId, targetUserId, title: 'Hi', body: 'Body' }),
    ).rejects.toBeInstanceOf(CustomerNotFoundException);
    expect(notificationRepository.save).not.toHaveBeenCalled();
  });

  it('persists the Notification (templateId null) and publishes both events for an eligible Customer', async () => {
    const { useCase, notificationRepository, eventPublisher } = build(true);

    const result = await useCase.execute({
      adminId,
      targetUserId,
      title: 'Your account has been verified',
      body: 'Thanks for confirming your details.',
      correlationId: 'corr-1',
    });

    expect(result.notificationId).toBeTruthy();
    expect(notificationRepository.save).toHaveBeenCalledTimes(1);
    const saved = notificationRepository.save.mock.calls[0][0];
    expect(saved.templateId).toBeNull();
    expect(saved.title).toBe('Your account has been verified');
    expect(saved.userId.value).toBe(targetUserId);

    expect(eventPublisher.publishAll).toHaveBeenCalledTimes(1);
    const [events] = eventPublisher.publishAll.mock.calls[0];
    expect(events).toHaveLength(2);
    expect(events[0]).toBeInstanceOf(NotificationCreatedEvent);
    expect(events[0].payload).toMatchObject({
      userId: targetUserId,
      reservationId: null,
      correlationId: 'corr-1',
    });
    expect(events[1]).toBeInstanceOf(PlatformAdminNotificationSentEvent);
    expect(events[1].payload).toMatchObject({ adminId, targetUserId, correlationId: 'corr-1' });
  });
});
