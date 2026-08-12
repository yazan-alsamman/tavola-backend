import { NotificationBroadcastSenderType } from '../../domain/enums/notification-broadcast.enums';
import { CreateNotificationBroadcastService } from './create-notification-broadcast.service';

const now = new Date('2026-08-12T12:00:00.000Z');

function build(totalRecipients: number) {
  const customerAudienceReader = {
    countBroadcastEligibleCustomers: jest.fn().mockResolvedValue(totalRecipients),
  };
  const broadcastRepository = { save: jest.fn().mockResolvedValue(undefined), findById: jest.fn() };
  const fanoutScheduler = { enqueueFanout: jest.fn().mockResolvedValue(undefined), enqueueContinuation: jest.fn() };
  const clock = { now: () => now };
  const idGenerator = { generate: () => 'broadcast-1' };

  const service = new CreateNotificationBroadcastService(
    customerAudienceReader as never,
    broadcastRepository as never,
    fanoutScheduler as never,
    clock as never,
    idGenerator as never,
  );
  return { service, customerAudienceReader, broadcastRepository, fanoutScheduler };
}

describe('CreateNotificationBroadcastService', () => {
  it('resolves the audience size, persists a Pending broadcast, and enqueues the kickoff job', async () => {
    const { service, broadcastRepository, fanoutScheduler } = build(1234);

    const result = await service.execute({
      senderType: NotificationBroadcastSenderType.PlatformAdmin,
      senderId: 'admin-1',
      organizationId: null,
      title: 'Title',
      body: 'Body',
      correlationId: 'corr-1',
    });

    expect(result).toEqual({ broadcastId: 'broadcast-1', totalRecipients: 1234 });

    expect(broadcastRepository.save).toHaveBeenCalledTimes(1);
    const saved = broadcastRepository.save.mock.calls[0][0];
    expect(saved.status).toBe('Pending');
    expect(saved.totalRecipients).toBe(1234);

    expect(fanoutScheduler.enqueueFanout).toHaveBeenCalledWith('broadcast-1', 'corr-1');
  });

  it('propagates the OrganizationMember sender fields for a Restaurant Owner broadcast', async () => {
    const { service, broadcastRepository } = build(50);

    await service.execute({
      senderType: NotificationBroadcastSenderType.OrganizationMember,
      senderId: 'owner-1',
      organizationId: 'org-1',
      title: 'Title',
      body: 'Body',
    });

    const saved = broadcastRepository.save.mock.calls[0][0];
    expect(saved.senderType).toBe('OrganizationMember');
    expect(saved.senderId).toBe('owner-1');
    expect(saved.organizationId).toBe('org-1');
  });
});
