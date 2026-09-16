import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';

/**
 * The identity payload `GET /platform-admin/me` returns. Deliberately the
 * union of the `User` profile fields a console header needs and the
 * `PlatformAdmin` authority fields it must not guess at - never the full
 * `User` row (no password hash, no session/permissions versions, no lockout
 * counters), per Rule 7's "do not expose sensitive account information
 * beyond what the authorization model permits".
 *
 * `role` is sourced from the live `PlatformAdmin` row rather than echoed
 * from the caller's JWT claim, so a console that renders its navigation from
 * this response reflects a demotion on the next poll rather than at next
 * login. `platformAdminCreatedAt` is the admin grant's creation date, not
 * the `User`'s.
 */
export interface PlatformAdminMeResult {
  readonly userId: string;
  readonly platformAdminId: string;
  readonly email: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly role: PlatformAdminRole;
  readonly status: string;
  readonly platformAdminCreatedAt: Date;
}
