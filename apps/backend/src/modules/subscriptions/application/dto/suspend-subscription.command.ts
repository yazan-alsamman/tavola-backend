import { PlatformAdminActor } from '@modules/platform-admin/application/dto/platform-admin-actor.dto';

export interface SuspendSubscriptionCommand {
  actor: PlatformAdminActor;
  organizationId: string;
  correlationId?: string;
}
