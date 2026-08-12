import { Inject, Injectable } from '@nestjs/common';
import { Email } from '@shared/domain/value-objects/email.vo';
import { Password } from '@shared/domain/value-objects/password.vo';
import { OrganizationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import {
  TenantContextPort,
  TENANT_CONTEXT_PORT,
} from '@shared/application/ports/tenant-context.port';
import {
  OrganizationInvitationRepository,
  OrganizationMemberRepository,
  OrganizationRepository,
} from '../../domain/repositories/organization.repository';
import {
  ORGANIZATION_INVITATION_REPOSITORY,
  ORGANIZATION_MEMBER_REPOSITORY,
  ORGANIZATION_REPOSITORY,
} from '../tokens/organizations.tokens';
import {
  USER_REPOSITORY,
  OPAQUE_TOKEN_SERVICE,
  PASSWORD_HASHER,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { User } from '@modules/authentication/domain/entities/user.entity';
import { UserStatus } from '@modules/authentication/domain/enums/authentication.enums';
import { OpaqueTokenService } from '@modules/authentication/domain/services/opaque-token.port';
import { PasswordHasher } from '@modules/authentication/domain/services/password-hasher.port';
import { InvalidRegistrationInputException } from '@modules/authentication/application/exceptions/invalid-registration-input.exception';
import { OrganizationMember } from '../../domain/entities/organization-member.entity';
import {
  OrganizationMemberRole,
  OrganizationMemberStatus,
} from '../../domain/enums/organization.enums';
import { OrganizationInvitationPolicy } from '../../domain/services/organization-invitation-policy';
import { InvalidInvitationTokenException } from '../../domain/exceptions/invalid-invitation-token.exception';
import { ExpiredInvitationTokenException } from '../../domain/exceptions/expired-invitation-token.exception';
import { InvitationEmailMismatchException } from '../../domain/exceptions/invitation-email-mismatch.exception';
import { InvitationRequiresLoginException } from '../../domain/exceptions/invitation-requires-login.exception';
import { InvitationOrganizationUnavailableException } from '../../domain/exceptions/invitation-organization-unavailable.exception';
import { InvitationTargetAlreadyMemberException } from '../../domain/exceptions/invitation-target-already-member.exception';
import { InvitationAcceptConflictException } from '../../domain/exceptions/invitation-accept-conflict.exception';
import { OrganizationInvitationAcceptedEvent } from '../../domain/events/organization.events';
import {
  AcceptOrganizationInvitationCommand,
  AcceptOrganizationInvitationResult,
} from '../dto/organization-invitation.dto';

/**
 * Phase 19.8 (Owner Invite, ADR-036, Option B). The single
 * `POST /invitations/:token/accept` endpoint (Section 6) serves both
 * Section 7 (existing User) and Section 8 (new User) branches - which one
 * runs is determined here by whether `invitation.email` already has a
 * `User` account, never by a client-supplied flag:
 *
 * - Existing account: the caller MUST already be authenticated
 *   (`command.authenticatedUserId` resolved by the controller from an
 *   optional Bearer token - this route carries no `@UseGuards`, since the
 *   new-account branch below must remain reachable anonymously) AND that
 *   authenticated identity must be exactly the invited User -
 *   `InvitationEmailMismatchException`/`InvitationRequiresLoginException`
 *   otherwise. Only an `OrganizationMember` row is created/reactivated.
 * - No existing account: `firstName`/`lastName`/`password` are required;
 *   the new `User.email` is always `invitation.email` - never taken from
 *   the request body (Section 8 - "do not allow the client to replace the
 *   invited email"). `User` + `OrganizationMember` are created atomically.
 *
 * Both branches run inside `TenantContextPort.runAsync` (the same
 * bootstrap-tenant-context mechanism `ProvisionRestaurantOwnerUseCase`
 * already uses) wrapping `UnitOfWorkPort.execute`, because neither branch
 * has an interceptor-bound `TenantContext` yet (the caller is either
 * anonymous, or authenticated only as a plain `User` actor, which carries no
 * `organizationId` claim) and `OrganizationMember` is a
 * `DIRECT_TENANT_OWNED_MODEL`. `invitationRepository.consumeIfPending`'s CAS
 * inside that same transaction is what actually prevents replay/concurrent
 * acceptance (Section 16/17) - a lost race throws
 * `InvitationAcceptConflictException`, rolling back everything else the
 * transaction did.
 */
@Injectable()
export class AcceptOrganizationInvitationUseCase {
  constructor(
    @Inject(ORGANIZATION_INVITATION_REPOSITORY)
    private readonly invitationRepository: OrganizationInvitationRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    @Inject(ORGANIZATION_MEMBER_REPOSITORY)
    private readonly memberRepository: OrganizationMemberRepository,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(OPAQUE_TOKEN_SERVICE) private readonly opaqueTokenService: OpaqueTokenService,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(
    command: AcceptOrganizationInvitationCommand,
  ): Promise<AcceptOrganizationInvitationResult> {
    const token = command.token?.trim();
    if (!token) {
      throw new InvalidInvitationTokenException();
    }

    const tokenHash = this.opaqueTokenService.hash(token);
    const invitation = await this.invitationRepository.findByTokenHash(tokenHash);
    if (invitation === null) {
      throw new InvalidInvitationTokenException();
    }
    if (!this.opaqueTokenService.verify(token, invitation.tokenHash)) {
      throw new InvalidInvitationTokenException();
    }

    const now = this.clock.now();
    const state = OrganizationInvitationPolicy.resolveState(invitation, now);
    if (state === 'accepted' || state === 'revoked') {
      // Anti-enumeration collapse (Section 8 of the audit) - deliberately
      // indistinguishable from "not found", mirrors
      // `ResetPasswordUseCase`'s 'consumed' handling exactly.
      throw new InvalidInvitationTokenException();
    }
    if (state === 'expired') {
      throw new ExpiredInvitationTokenException();
    }

    const organizationId = invitation.organizationId;
    const organization = await this.organizationRepository.findById(organizationId);
    if (organization === null || !organization.isActive()) {
      throw new InvitationOrganizationUnavailableException();
    }

    const existingUser = await this.userRepository.findByEmail(Email.create(invitation.email));

    let userId: UserId;
    let newUser: User | null;
    if (existingUser) {
      userId = await this.resolveExistingUser(existingUser.userId, command);
      newUser = null;
    } else {
      userId = UserId.create(this.idGenerator.generate());
      newUser = await this.buildNewUser(userId, invitation.email, command, now);
    }
    const accountCreated = newUser !== null;

    const member = await this.acceptWithinTenantContext({
      organizationId,
      userId,
      role: invitation.role,
      invitationId: invitation.id,
      now,
      correlationId: command.correlationId,
      newUser,
    });

    await this.eventPublisher.publish(
      new OrganizationInvitationAcceptedEvent(
        this.idGenerator.generate(),
        {
          organizationId: organizationId.value,
          actorId: userId.value,
          invitationId: invitation.id,
          memberId: member.id,
          targetUserId: userId.value,
          role: invitation.role,
          accountCreated,
        },
        now,
        command.correlationId,
      ),
    );

    return {
      organizationId: organizationId.value,
      memberId: member.id,
      userId: userId.value,
      role: invitation.role,
      accountCreated,
    };
  }

  /** Section 7 - existing account. */
  private async resolveExistingUser(
    existingUserId: UserId,
    command: AcceptOrganizationInvitationCommand,
  ): Promise<UserId> {
    if (command.authenticatedUserId === null) {
      throw new InvitationRequiresLoginException();
    }
    if (command.authenticatedUserId !== existingUserId.value) {
      throw new InvitationEmailMismatchException();
    }
    return existingUserId;
  }

  /** Section 8 - no existing account; builds (but does not yet persist - persistence happens atomically in `acceptWithinTenantContext`) the new User for the given, already-generated `userId`. */
  private async buildNewUser(
    userId: UserId,
    invitedEmail: string,
    command: AcceptOrganizationInvitationCommand,
    now: Date,
  ): Promise<User> {
    if (!command.firstName?.trim() || !command.lastName?.trim() || !command.password) {
      throw new InvalidRegistrationInputException(
        'firstName, lastName, and password are required to accept this invitation.',
      );
    }
    const passwordHash = await this.passwordHasher.hash(Password.create(command.password));
    return User.create({
      id: userId.value,
      firstName: command.firstName!.trim(),
      lastName: command.lastName!.trim(),
      // Always the invited email - never client-suppliable (Section 8).
      email: invitedEmail,
      phone: null,
      username: null,
      passwordHash: passwordHash.value,
      language: 'en',
      preferredCurrency: null,
      notificationOptIn: true,
      marketingOptIn: false,
      status: UserStatus.Active,
      // Token receipt itself proves possession of the invited email
      // (Section 8) - the same trust model already used for
      // administratively-provisioned Owner accounts
      // (ProvisionRestaurantOwnerUseCase).
      emailVerified: true,
      failedLoginCount: 0,
      lockedUntil: null,
      permissionsVersion: 1,
      sessionVersion: 1,
      passwordChangedAt: null,
      lastLoginAt: null,
      anonymizedAt: null,
      deletionRequestedAt: null,
      scheduledAnonymizationAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  private async acceptWithinTenantContext(input: {
    organizationId: OrganizationId;
    userId: UserId;
    role: OrganizationMemberRole;
    invitationId: string;
    now: Date;
    correlationId?: string;
    newUser: User | null;
  }): Promise<OrganizationMember> {
    return this.tenantContext.runAsync(
      {
        organizationId: input.organizationId.value,
        userId: input.userId.value,
        correlationId: input.correlationId ?? input.invitationId,
      },
      () =>
        this.unitOfWork.execute(async () => {
          if (input.newUser) {
            await this.userRepository.save(input.newUser);
          }

          const existingMembership = await this.memberRepository.findByOrganizationAndUser(
            input.organizationId,
            input.userId,
          );
          if (existingMembership !== null && existingMembership.isActive()) {
            throw new InvitationTargetAlreadyMemberException();
          }

          const member = existingMembership
            ? OrganizationMember.reconstitute({
                ...existingMembership.toProps(),
                role: input.role,
                status: OrganizationMemberStatus.Active,
                joinedAt: input.now,
                updatedAt: input.now,
              })
            : OrganizationMember.create({
                id: this.idGenerator.generate(),
                organizationId: input.organizationId.value,
                userId: input.userId.value,
                role: input.role,
                status: OrganizationMemberStatus.Active,
                invitedAt: input.now,
                joinedAt: input.now,
                createdAt: input.now,
                updatedAt: input.now,
              });
          await this.memberRepository.save(member);

          const consumed = await this.invitationRepository.consumeIfPending(
            input.invitationId,
            input.now,
          );
          if (!consumed) {
            throw new InvitationAcceptConflictException();
          }

          return member;
        }),
    );
  }
}
