import { Reflector } from '@nestjs/core';
import { InvalidPermissionSlugException } from '@shared/domain/value-objects/permission-slug.vo';
import { REQUIRE_PERMISSION_KEY, RequirePermission } from './require-permission.decorator';

class TestController {
  @RequirePermission('reservations:approve')
  protectedHandler() {
    return null;
  }

  unprotectedHandler() {
    return null;
  }
}

describe('RequirePermission decorator', () => {
  const reflector = new Reflector();
  const controller = new TestController();

  it('stores the permission slug as handler-level metadata', () => {
    const metadata = reflector.get<string>(REQUIRE_PERMISSION_KEY, controller.protectedHandler);
    expect(metadata).toBe('reservations:approve');
  });

  it('leaves handlers without the decorator with no metadata', () => {
    const metadata = reflector.get<string | undefined>(
      REQUIRE_PERMISSION_KEY,
      controller.unprotectedHandler,
    );
    expect(metadata).toBeUndefined();
  });

  it('rejects a malformed permission slug at decoration time', () => {
    expect(() => {
      class _Invalid {
        @RequirePermission('NotASlug')
        handler() {
          return null;
        }
      }
      return _Invalid;
    }).toThrow(InvalidPermissionSlugException);
  });

  it('normalizes slug casing, matching PermissionSlug.create', () => {
    class UppercaseController {
      @RequirePermission('Reservations:Approve')
      handler() {
        return null;
      }
    }
    const instance = new UppercaseController();
    const metadata = reflector.get<string>(REQUIRE_PERMISSION_KEY, instance.handler);
    expect(metadata).toBe('reservations:approve');
  });
});
