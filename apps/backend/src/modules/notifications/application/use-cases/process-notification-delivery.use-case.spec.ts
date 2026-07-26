import { Notification } from '../../domain/entities/notification.entity';
import { NotificationTemplate } from '../../domain/entities/notification-template.entity';
import { NotificationChannel } from '../../domain/enums/notification.enums';
import { ReservationReminderSentEvent } from '@modules/reservations/domain/events/reservation.events';
import { WaitlistEntryNotifiedEvent } from '@modules/waitlist/domain/events/waitlist.events';
import { WaitlistStatus } from '@modules/waitlist/domain/enums/waitlist.enums';
import { ReservationWaitlistEntry } from '@modules/waitlist/domain/entities/reservation-waitlist-entry.entity';
import { User } from '@modules/authentication/domain/entities/user.entity';
import { UserStatus } from '@modules/authentication/domain/enums/authentication.enums';
import { ProcessNotificationDeliveryUseCase } from './process-notification-delivery.use-case';

const now = new Date('2026-07-25T12:00:00.000Z');
const userId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const notificationId = '11111111-1111-4111-8111-111111111111';
const entryId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const reservationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const restaurantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const branchId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function queuedNotification(
  overrides: {
    type?: string;
    data?: Record<string, unknown> | null;
  } = {},
): Notification {
  const created = Notification.create({
    id: notificationId,
    userId,
    type: overrides.type ?? 'ReservationApproved',
    templateId: null,
    title: 'In-app title',
    body: 'In-app body',
    data: overrides.data === undefined ? { reservationId } : overrides.data,
    now,
  });
  return created.enqueuePush('idem-key-1', now);
}

function activeUser(): User {
  return User.create({
    id: userId,
    firstName: 'Test',
    lastName: 'User',
    email: null,
    phone: '+15551234567',
    username: 'testuser',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$c29tZWhhc2g',
    language: 'en',
    preferredCurrency: null,
    notificationOptIn: true,
    marketingOptIn: false,
    status: UserStatus.Active,
    emailVerified: true,
    failedLoginCount: 0,
    lockedUntil: null,
    permissionsVersion: 1,
    sessionVersion: 1,
    passwordChangedAt: null,
    lastLoginAt: null,
    anonymizedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
}

function pushTemplate(): NotificationTemplate {
  return NotificationTemplate.create({
    id: 'push-template-1',
    eventType: 'ReservationApproved',
    language: 'en',
    channel: NotificationChannel.Push,
    title: 'Push title',
    body: 'Push body',
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
}

function waitlistEntry(status: WaitlistStatus): ReservationWaitlistEntry {
  const created = ReservationWaitlistEntry.create({
    id: entryId,
    restaurantId,
    branchId,
    userId,
    reservationGuestId: null,
    partySize: 2,
    preferredDate: new Date('2026-08-01T00:00:00.000Z'),
    preferredTimeFrom: new Date('2026-08-01T18:00:00.000Z'),
    preferredTimeTo: null,
    position: 1,
    expiresAt: new Date('2026-08-01T20:00:00.000Z'),
    notes: null,
    createdBy: userId,
    now,
  });
  return ReservationWaitlistEntry.reconstitute({ ...created.toProps(), status });
}

function build(
  overrides: {
    notification?: Notification | null;
    user?: User | null;
    sendResult?: unknown;
  } = {},
) {
  const notification =
    overrides.notification === undefined ? queuedNotification() : overrides.notification;

  const notificationRepository = {
    findById: jest.fn().mockResolvedValue(notification),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const templateRepository = {
    findExact: jest.fn().mockResolvedValue(pushTemplate()),
    findDefault: jest.fn().mockResolvedValue(null),
  };
  const userRepository = {
    findById: jest
      .fn()
      .mockResolvedValue(overrides.user === undefined ? activeUser() : overrides.user),
  };
  const provider = {
    send: jest
      .fn()
      .mockResolvedValue(
        overrides.sendResult ?? { outcome: 'accepted', providerMessageId: 'msg-1' },
      ),
  };
  const waitlistEntryRepository = {
    findById: jest.fn(),
    updateTransitioningFrom: jest.fn().mockResolvedValue(true),
  };
  const eventPublisher = { publish: jest.fn().mockResolvedValue(undefined), publishAll: jest.fn() };
  const clock = { now: () => now };
  let counter = 0;
  const idGenerator = { generate: () => `generated-${++counter}` };

  const useCase = new ProcessNotificationDeliveryUseCase(
    notificationRepository as never,
    templateRepository as never,
    userRepository as never,
    provider as never,
    waitlistEntryRepository as never,
    eventPublisher as never,
    clock as never,
    idGenerator as never,
  );

  return {
    useCase,
    notificationRepository,
    templateRepository,
    provider,
    waitlistEntryRepository,
    eventPublisher,
  };
}

describe('ProcessNotificationDeliveryUseCase', () => {
  it('records Accepted and stores the providerMessageId on provider acceptance', async () => {
    const { useCase, notificationRepository } = build();

    await useCase.execute({ notificationId, isFinalAttempt: false });

    const saved = notificationRepository.save.mock.calls[0][0] as Notification;
    expect(saved.pushStatus).toBe('Accepted');
    expect(saved.pushProviderMessageId).toBe('msg-1');
  });

  it('resolves the Push channel template independently of the already-persisted In-App title/body', async () => {
    const { useCase, provider } = build();

    await useCase.execute({ notificationId, isFinalAttempt: false });

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Push title', body: 'Push body' }),
    );
  });

  it('records Failed(no_subscription) on noRecipients, never Accepted', async () => {
    const { useCase, notificationRepository } = build({ sendResult: { outcome: 'noRecipients' } });

    await useCase.execute({ notificationId, isFinalAttempt: false });

    const saved = notificationRepository.save.mock.calls[0][0] as Notification;
    expect(saved.pushStatus).toBe('Failed');
    expect(saved.pushFailureReason).toBe('no_subscription');
  });

  it('records Failed(provider_error) on permanentFailure', async () => {
    const { useCase, notificationRepository } = build({
      sendResult: { outcome: 'permanentFailure', reason: 'invalid_request' },
    });

    await useCase.execute({ notificationId, isFinalAttempt: false });

    const saved = notificationRepository.save.mock.calls[0][0] as Notification;
    expect(saved.pushStatus).toBe('Failed');
    expect(saved.pushFailureReason).toBe('provider_error');
  });

  it('rethrows on retryableFailure when not the final attempt (lets BullMQ retry), without writing the row', async () => {
    const { useCase, notificationRepository } = build({
      sendResult: { outcome: 'retryableFailure', reason: 'timeout' },
    });

    await expect(useCase.execute({ notificationId, isFinalAttempt: false })).rejects.toThrow();
    expect(notificationRepository.save).not.toHaveBeenCalled();
  });

  it('records Failed(rate_limited) on retryableFailure when it is the final attempt, without rethrowing', async () => {
    const { useCase, notificationRepository } = build({
      sendResult: { outcome: 'retryableFailure', reason: 'timeout' },
    });

    await expect(
      useCase.execute({ notificationId, isFinalAttempt: true }),
    ).resolves.toBeUndefined();
    const saved = notificationRepository.save.mock.calls[0][0] as Notification;
    expect(saved.pushStatus).toBe('Failed');
    expect(saved.pushFailureReason).toBe('rate_limited');
  });

  it('is a safe no-op for an already-terminal Notification (stale/duplicate job)', async () => {
    const terminal = queuedNotification().recordPushAccepted('already-sent', now);
    const { useCase, notificationRepository, provider } = build({ notification: terminal });

    await useCase.execute({ notificationId, isFinalAttempt: false });

    expect(provider.send).not.toHaveBeenCalled();
    expect(notificationRepository.save).not.toHaveBeenCalled();
  });

  it('is a safe no-op for a stale job whose Notification no longer exists', async () => {
    const { useCase, notificationRepository, provider } = build({ notification: null });

    await expect(
      useCase.execute({ notificationId, isFinalAttempt: false }),
    ).resolves.toBeUndefined();
    expect(provider.send).not.toHaveBeenCalled();
    expect(notificationRepository.save).not.toHaveBeenCalled();
  });

  describe('ReservationReminderSent emission (decision item 6)', () => {
    it('publishes ReservationReminderSentEvent only when the source type is ReservationReminderDue and push is Accepted', async () => {
      const notification = queuedNotification({
        type: 'ReservationReminderDue',
        data: { reservationId, restaurantId, branchId, reservationStartTime: now.toISOString() },
      });
      const { useCase, eventPublisher } = build({ notification });

      await useCase.execute({ notificationId, isFinalAttempt: false });

      expect(eventPublisher.publish).toHaveBeenCalledWith(expect.any(ReservationReminderSentEvent));
    });

    it('never publishes ReservationReminderSent for a non-reminder event type', async () => {
      const { useCase, eventPublisher } = build();

      await useCase.execute({ notificationId, isFinalAttempt: false });

      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('never publishes ReservationReminderSent when the push fails', async () => {
      const notification = queuedNotification({
        type: 'ReservationReminderDue',
        data: { reservationId, restaurantId, branchId, reservationStartTime: now.toISOString() },
      });
      const { useCase, eventPublisher } = build({
        notification,
        sendResult: { outcome: 'permanentFailure', reason: 'invalid' },
      });

      await useCase.execute({ notificationId, isFinalAttempt: false });

      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('WaitlistEntryNotified activation (decision item 7)', () => {
    it('transitions Waiting -> Notified and publishes WaitlistEntryNotifiedEvent only after push Accepted', async () => {
      const notification = queuedNotification({
        type: 'WaitlistEntryPromoted',
        data: { entryId, restaurantId, branchId },
      });
      const { useCase, waitlistEntryRepository, eventPublisher } = build({ notification });
      waitlistEntryRepository.findById.mockResolvedValue(waitlistEntry(WaitlistStatus.Waiting));

      await useCase.execute({ notificationId, isFinalAttempt: false });

      expect(waitlistEntryRepository.updateTransitioningFrom).toHaveBeenCalledWith(
        expect.objectContaining({ status: WaitlistStatus.Notified }),
        WaitlistStatus.Waiting,
      );
      expect(eventPublisher.publish).toHaveBeenCalledWith(expect.any(WaitlistEntryNotifiedEvent));
    });

    it('never activates Notified when the entry already left Waiting (Converted/Cancelled/Expired race)', async () => {
      const notification = queuedNotification({
        type: 'WaitlistEntryPromoted',
        data: { entryId, restaurantId, branchId },
      });
      const { useCase, waitlistEntryRepository, eventPublisher } = build({ notification });
      waitlistEntryRepository.findById.mockResolvedValue(waitlistEntry(WaitlistStatus.Cancelled));

      await useCase.execute({ notificationId, isFinalAttempt: false });

      expect(waitlistEntryRepository.updateTransitioningFrom).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('never activates Notified merely because push failed', async () => {
      const notification = queuedNotification({
        type: 'WaitlistEntryPromoted',
        data: { entryId, restaurantId, branchId },
      });
      const { useCase, waitlistEntryRepository, eventPublisher } = build({
        notification,
        sendResult: { outcome: 'noRecipients' },
      });
      waitlistEntryRepository.findById.mockResolvedValue(waitlistEntry(WaitlistStatus.Waiting));

      await useCase.execute({ notificationId, isFinalAttempt: false });

      expect(waitlistEntryRepository.updateTransitioningFrom).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('does not publish WaitlistEntryNotified when the CAS update loses a concurrent race', async () => {
      const notification = queuedNotification({
        type: 'WaitlistEntryPromoted',
        data: { entryId, restaurantId, branchId },
      });
      const { useCase, waitlistEntryRepository, eventPublisher } = build({ notification });
      waitlistEntryRepository.findById.mockResolvedValue(waitlistEntry(WaitlistStatus.Waiting));
      waitlistEntryRepository.updateTransitioningFrom.mockResolvedValue(false);

      await useCase.execute({ notificationId, isFinalAttempt: false });

      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('idempotency key reuse', () => {
    it('reuses the Notification row own pushIdempotencyKey verbatim across calls, never regenerating', async () => {
      const { useCase, provider } = build();

      await useCase.execute({ notificationId, isFinalAttempt: false });

      expect(provider.send).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'idem-key-1' }),
      );
    });
  });
});
