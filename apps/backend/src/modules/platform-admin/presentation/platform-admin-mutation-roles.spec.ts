import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PlatformAdminController } from './controllers/platform-admin.controller';
import { PlatformAdminSubscriptionsController } from '@modules/subscriptions/presentation/controllers/platform-admin-subscriptions.controller';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { PlatformAdminRoleGuard } from './guards/platform-admin-role.guard';
import { REQUIRE_PLATFORM_ADMIN_ROLE_KEY } from './decorators/require-platform-admin-role.decorator';
import { PlatformAdminRole } from '../domain/enums/platform-admin.enums';

/**
 * PlatformSupport is a read-only console role. Every Platform Admin route
 * that creates an account or changes a subscription must be limited to
 * PlatformAdmin at the server, not only hidden in the console UI.
 */
describe('Platform Admin mutation routes are PlatformAdmin-only', () => {
  const cases: Array<[string, (...args: never[]) => unknown]> = [
    [
      'POST /platform-admin/restaurant-owners',
      PlatformAdminController.prototype.provisionRestaurantOwner,
    ],
    [
      'POST /platform-admin/organizations/:id/subscription',
      PlatformAdminSubscriptionsController.prototype.assignSubscription,
    ],
    [
      'POST /platform-admin/organizations/:id/subscription/suspend',
      PlatformAdminSubscriptionsController.prototype.suspend,
    ],
    [
      'POST /platform-admin/organizations/:id/subscription/reactivate',
      PlatformAdminSubscriptionsController.prototype.reactivate,
    ],
    [
      'POST /platform-admin/organizations/:id/subscription/cancel',
      PlatformAdminSubscriptionsController.prototype.cancel,
    ],
  ];

  it.each(cases)('%s runs PlatformAdminGuard then PlatformAdminRoleGuard', (_route, handler) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
    expect(guards).toEqual([PlatformAdminGuard, PlatformAdminRoleGuard]);
  });

  it.each(cases)('%s requires the PlatformAdmin role only', (_route, handler) => {
    const roles = Reflect.getMetadata(REQUIRE_PLATFORM_ADMIN_ROLE_KEY, handler) as string[];
    expect(roles).toEqual([PlatformAdminRole.PlatformAdmin]);
  });
});
