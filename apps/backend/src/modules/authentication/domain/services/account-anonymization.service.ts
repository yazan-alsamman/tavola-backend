import { User } from '../entities/user.entity';
import { UserStatus } from '../enums/authentication.enums';

/**
 * DOMAIN_MODEL.md Domain Services: "AccountAnonymizationService - implements
 * the anonymization mechanics defined in ADR-014; invoked by the
 * `AnonymizeUserAccount` use case, never invoked implicitly by unrelated
 * flows." Pure transform, no ports/side effects - matches
 * `OrganizationMembershipPolicy`/`PasswordResetPolicy`'s existing
 * static-class convention for domain services in this codebase.
 *
 * ADR-014 §2: overwrites every direct personal-data field with a fixed or
 * deterministic-non-reversible placeholder, invalidates the password hash,
 * and marks the row `UserStatus.Anonymized` - never a physical delete.
 * `User.canLogin()` already rejects `Anonymized` before any password check
 * runs (see `LoginUseCase`), so the exact placeholder hash value has no
 * security relevance; it exists only so `PasswordHash.create()`'s
 * non-empty invariant is satisfied.
 */
export class AccountAnonymizationService {
  static anonymize(user: User, placeholderId: string, at: Date): User {
    const props = user.toProps();
    return User.reconstitute({
      ...props,
      firstName: 'Deleted',
      lastName: 'User',
      email: `deleted-${placeholderId}@anonymized.local`,
      phone: null,
      username: null,
      passwordHash: `ANONYMIZED-${placeholderId}`,
      status: UserStatus.Anonymized,
      anonymizedAt: at,
      deletionRequestedAt: null,
      scheduledAnonymizationAt: null,
      updatedAt: at,
    });
  }
}
