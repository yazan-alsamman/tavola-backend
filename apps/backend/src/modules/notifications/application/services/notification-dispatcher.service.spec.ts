import {
  GuestLateArrivalNotifiedEvent,
  ReservationApprovedEvent,
  ReservationCancelledEvent,
  ReservationCreatedEvent,
  ReservationExpiredEvent,
  ReservationNoShowEvent,
  ReservationRescheduledEvent,
  ReservationReminderDueEvent,
  TableReadyNotifiedEvent,
} from '@modules/reservations/domain/events/reservation.events';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';
import { WaitlistEntryPromotedEvent } from '@modules/waitlist/domain/events/waitlist.events';
import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import { User } from '@modules/authentication/domain/entities/user.entity';
import { UserStatus } from '@modules/authentication/domain/enums/authentication.enums';
import { NotificationTemplate } from '../../domain/entities/notification-template.entity';
import { NotificationChannel } from '../../domain/enums/notification.enums';
import {
  NotificationDispatcher,
  resolveNotificationIntent,
} from './notification-dispatcher.service';

const now = new Date('2026-07-25T12:00:00.000Z');
const reservationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const restaurantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const branchId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const tableId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const userId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const entryId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

describe('resolveNotificationIntent (Phase 9 frozen event -> notification allow-list)', () => {
  const pushEligibleCases: Array<
    [string, () => import('@shared/domain/base/domain-event.base').DomainEvent]
  > = [
    [
      'ReservationApproved',
      () =>
        new ReservationApprovedEvent('e1', {
          reservationId,
          restaurantId,
          branchId,
          tableId,
          approvedBy: null,
          automatic: true,
        }),
    ],
    [
      'ReservationCancelled',
      () =>
        new ReservationCancelledEvent('e1', {
          reservationId,
          restaurantId,
          branchId,
          tableId,
          cancelledBy: userId,
          withinCancellationWindow: true,
        }),
    ],
    [
      'ReservationRescheduled',
      () =>
        new ReservationRescheduledEvent('e1', {
          reservationId,
          restaurantId,
          branchId,
          oldTableId: tableId,
          newTableId: tableId,
          rescheduledBy: userId,
        }),
    ],
    [
      'ReservationReminderDue',
      () =>
        new ReservationReminderDueEvent('e1', {
          reservationId,
          restaurantId,
          branchId,
          reservationStartTime: now.toISOString(),
        }),
    ],
    [
      'TableReadyNotified',
      () =>
        new TableReadyNotifiedEvent('e1', {
          reservationId,
          restaurantId,
          branchId,
          reservationStartTime: now.toISOString(),
          tableReadyNotifiedAt: now.toISOString(),
          markedBy: 'employee-1',
        }),
    ],
    [
      'WaitlistEntryPromoted',
      () =>
        new WaitlistEntryPromotedEvent('e1', {
          entryId,
          restaurantId,
          branchId,
          convertedReservationId: reservationId,
          promotedBy: null,
        }),
    ],
  ];

  it.each(pushEligibleCases)('%s resolves to a Push+In-App intent', (eventType, build) => {
    const intent = resolveNotificationIntent(build());
    expect(intent).not.toBeNull();
    expect(intent?.eventType).toBe(eventType);
    expect(intent?.pushEligible).toBe(true);
  });

  it('ReservationNoShow resolves to an In-App-only intent (pushEligible: false)', () => {
    const intent = resolveNotificationIntent(
      new ReservationNoShowEvent('e1', {
        reservationId,
        restaurantId,
        branchId,
        tableId,
        markedBy: 'employee-1',
      }),
    );
    expect(intent).not.toBeNull();
    expect(intent?.eventType).toBe('ReservationNoShow');
    expect(intent?.pushEligible).toBe(false);
  });

  it('GuestLateArrivalNotified produces no notification (owner-confirmed exclusion)', () => {
    const intent = resolveNotificationIntent(
      new GuestLateArrivalNotifiedEvent('e1', {
        reservationId,
        restaurantId,
        branchId,
        reservationStartTime: now.toISOString(),
        lateArrivalNotifiedAt: now.toISOString(),
      }),
    );
    expect(intent).toBeNull();
  });

  it('ReservationExpired produces no notification (owner-confirmed exclusion)', () => {
    const intent = resolveNotificationIntent(
      new ReservationExpiredEvent('e1', { reservationId, restaurantId, branchId, tableId }),
    );
    expect(intent).toBeNull();
  });

  it('an unrelated event (ReservationCreated) produces no notification (default-deny)', () => {
    const intent = resolveNotificationIntent(
      new ReservationCreatedEvent('e1', {
        reservationId,
        restaurantId,
        branchId,
        tableId,
        userId,
        reservationGuestId: null,
        source: ReservationSource.Online,
        createdBy: userId,
      }),
    );
    expect(intent).toBeNull();
  });
});

describe('NotificationDispatcher', () => {
  function approvedEvent() {
    return new ReservationApprovedEvent('e1', {
      reservationId,
      restaurantId,
      branchId,
      tableId,
      approvedBy: null,
      automatic: true,
    });
  }

  function reservationFor(ownerUserId: string | null) {
    return Reservation.create({
      id: reservationId,
      userId: ownerUserId,
      reservationGuestId: ownerUserId ? null : 'guest-1',
      source: ReservationSource.Online,
      restaurantId,
      branchId,
      tableId,
      reservationDate: new Date('2026-08-01T00:00:00.000Z'),
      reservationStartTime: new Date('2026-08-01T18:00:00.000Z'),
      reservationEndTime: new Date('2026-08-01T19:30:00.000Z'),
      guests: 2,
      tableCapacity: 4,
      notes: null,
      createdBy: null,
      now,
    });
  }

  function userWith(props: { notificationOptIn: boolean }) {
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
      notificationOptIn: props.notificationOptIn,
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

  function inAppTemplate() {
    return NotificationTemplate.create({
      id: 'template-inapp-1',
      eventType: 'ReservationApproved',
      language: 'en',
      channel: NotificationChannel.InApp,
      title: 'Reservation confirmed',
      body: 'Your reservation has been confirmed.',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  function buildDispatcher(overrides: {
    reservationUserId?: string | null;
    notificationOptIn?: boolean;
    template?: NotificationTemplate | null;
  }) {
    const reservationOwnerId =
      overrides.reservationUserId !== undefined ? overrides.reservationUserId : userId;
    const reservationRepository = {
      findById: jest.fn().mockResolvedValue(reservationFor(reservationOwnerId)),
    };
    const waitlistEntryRepository = { findById: jest.fn() };
    const userRepository = {
      findById: jest
        .fn()
        .mockResolvedValue(userWith({ notificationOptIn: overrides.notificationOptIn ?? true })),
    };
    const notificationRepository = { save: jest.fn().mockResolvedValue(undefined) };
    const templateRepository = {
      findExact: jest
        .fn()
        .mockResolvedValue(overrides.template === undefined ? inAppTemplate() : overrides.template),
      findDefault: jest
        .fn()
        .mockResolvedValue(overrides.template === undefined ? null : overrides.template),
    };
    const deliveryScheduler = { enqueueDelivery: jest.fn().mockResolvedValue(undefined) };
    const clock = { now: () => now };
    let counter = 0;
    const idGenerator = { generate: () => `generated-id-${++counter}` };

    const dispatcher = new NotificationDispatcher(
      reservationRepository as never,
      waitlistEntryRepository as never,
      userRepository as never,
      notificationRepository as never,
      templateRepository as never,
      deliveryScheduler as never,
      clock as never,
      idGenerator as never,
    );

    return { dispatcher, notificationRepository, deliveryScheduler, userRepository };
  }

  it('creates a durable Notification and enqueues Push when notificationOptIn is true', async () => {
    const { dispatcher, notificationRepository, deliveryScheduler } = buildDispatcher({});

    const result = await dispatcher.dispatch(approvedEvent());

    expect(result).not.toBeNull();
    expect(notificationRepository.save).toHaveBeenCalledTimes(1);
    expect(deliveryScheduler.enqueueDelivery).toHaveBeenCalledTimes(1);
    const saved = notificationRepository.save.mock.calls[0][0];
    expect(saved.pushStatus).toBe('Queued');
  });

  it('notificationOptIn=false still creates the durable Notification but never enqueues Push', async () => {
    const { dispatcher, notificationRepository, deliveryScheduler } = buildDispatcher({
      notificationOptIn: false,
    });

    const result = await dispatcher.dispatch(approvedEvent());

    expect(result).not.toBeNull();
    expect(notificationRepository.save).toHaveBeenCalledTimes(1);
    const saved = notificationRepository.save.mock.calls[0][0];
    expect(saved.pushStatus).toBe('NotAttempted');
    expect(deliveryScheduler.enqueueDelivery).not.toHaveBeenCalled();
  });

  it('a guest-backed source Reservation (no userId) produces no Notification at all', async () => {
    const { dispatcher, notificationRepository, deliveryScheduler } = buildDispatcher({
      reservationUserId: null,
    });

    const result = await dispatcher.dispatch(approvedEvent());

    expect(result).toBeNull();
    expect(notificationRepository.save).not.toHaveBeenCalled();
    expect(deliveryScheduler.enqueueDelivery).not.toHaveBeenCalled();
  });

  it('falls back to the isDefault template when no exact-language template exists, and still creates the Notification', async () => {
    const fallback = NotificationTemplate.create({
      id: 'template-default-1',
      eventType: 'ReservationApproved',
      language: 'en',
      channel: NotificationChannel.InApp,
      title: 'Default title',
      body: 'Default body',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
    const { dispatcher, notificationRepository } = buildDispatcher({ template: fallback });

    await dispatcher.dispatch(approvedEvent());

    const saved = notificationRepository.save.mock.calls[0][0];
    expect(saved.title).toBe('Default title');
    expect(saved.body).toBe('Default body');
  });

  it('produces no Notification when neither an exact nor a default template exists (fails safe, never throws)', async () => {
    const { dispatcher, notificationRepository } = buildDispatcher({ template: null });

    const result = await dispatcher.dispatch(approvedEvent());

    expect(result).toBeNull();
    expect(notificationRepository.save).not.toHaveBeenCalled();
  });

  it('an enqueue failure never throws - the Notification row still saved (accepted lossy-push boundary)', async () => {
    const { dispatcher, notificationRepository, deliveryScheduler } = buildDispatcher({});
    deliveryScheduler.enqueueDelivery.mockRejectedValue(new Error('redis down'));

    await expect(dispatcher.dispatch(approvedEvent())).resolves.not.toBeNull();
    expect(notificationRepository.save).toHaveBeenCalledTimes(1);
  });
});
