import { SetMetadata } from '@nestjs/common';
import { PermissionSlug } from '@shared/domain/value-objects/permission-slug.vo';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

/**
 * Declares the single RBAC permission slug a handler requires
 * (AUTHORIZATION_ARCHITECTURE.md §9). Only singular-permission semantics are
 * implemented here per Phase 2.15's exact scope; `@RequireAnyPermission` /
 * `@RequireAllPermissions` are documented as future decorators, not this one.
 *
 * Validates the slug shape at decoration time (via `PermissionSlug`) so a
 * typo'd permission string fails at application bootstrap, not silently at
 * request time - the guard itself compares plain strings against the
 * already-resolved `permissions: string[]` on the authenticated actor, the
 * same representation used everywhere else (JWT claims, RbacPermissionResolver).
 */
export const RequirePermission = (permission: string): MethodDecorator => {
  const validated = PermissionSlug.create(permission).value;
  return SetMetadata(REQUIRE_PERMISSION_KEY, validated);
};
