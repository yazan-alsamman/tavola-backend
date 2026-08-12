import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Email } from '@shared/domain/value-objects/email.vo';
import { OrganizationId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import {
  SYSTEM_CONFIG_KEYS,
  SystemConfigurationPort,
} from '@shared/application/ports/system-configuration.port';
import { EmailProviderPort, EMAIL_PROVIDER } from '@shared/application/ports/email-provider.port';
import { AppConfig } from '@config/app.config';
import {
  OrganizationInvitationRepository,
  OrganizationMemberRepository,
} from '../../domain/repositories/organization.repository';
import {
  ORGANIZATION_INVITATION_REPOSITORY,
  ORGANIZATION_MEMBER_REPOSITORY,
} from '../tokens/organizations.tokens';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { OrganizationInvitation } from '../../domain/entities/organization-invitation.entity';
import { OrganizationInvitationStatus } from '../../domain/enums/organization.enums';
import { OrganizationInvitationPolicy } from '../../domain/services/organization-invitation-policy';
import { InvitationTargetAlreadyMemberException } from '../../domain/exceptions/invitation-target-already-member.exception';
import { OpaqueTokenService } from '@modules/authentication/domain/services/opaque-token.port';
import {
  OPAQUE_TOKEN_SERVICE,
  SYSTEM_CONFIGURATION,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import { OrganizationMemberInvitedEvent } from '../../domain/events/organization.events';
import {
  IssueOrganizationInvitationCommand,
  OrganizationInvitationResult,
} from '../dto/organization-invitation.dto';
import { toOrganizationInvitationResult } from '../mappers/organization-invitation-result.mapper';

const DEFAULT_INVITATION_TTL_HOURS = 168; // 7 days (Section 10)

/**
 * Phase 19.8 (Owner Invite, ADR-036, Option B). Owner/Admin only, gated by
 * `OrganizationMemberGuard` + `@RequireOrgRole(Owner, Admin)` at the
 * controller - the same guard/decorator pair the existing self-service
 * member-management endpoints already use.
 *
 * Resend semantics (Section 11): re-inviting the same `(organizationId,
 * email)` revokes any still-Pending invitation first, then issues a new one,
 * inside the same transaction - mirrors `ForgotPasswordUseCase`'s
 * `invalidateActiveByUserId` + `save` shape exactly. The database's own
 * partial unique index is the ultimate guard against two simultaneously
 * live Pending rows (a concurrent double-issue race surfaces as
 * `DuplicatePendingInvitationException`, translated by the repository).
 *
 * Email delivery (Section 9) is best-effort, matching
 * `NotifyingEventPublisher`'s existing "never rethrows into the business
 * transaction" convention: the invitation record itself is the source of
 * truth (the Owner can always re-view/resend it), so a transient SMTP
 * failure must not roll back or fail an otherwise-successful issuance.
 */
@Injectable()
export class IssueOrganizationInvitationUseCase {
  private readonly logger = new Logger(IssueOrganizationInvitationUseCase.name);

  constructor(
    @Inject(ORGANIZATION_INVITATION_REPOSITORY)
    private readonly invitationRepository: OrganizationInvitationRepository,
    @Inject(ORGANIZATION_MEMBER_REPOSITORY)
    private readonly memberRepository: OrganizationMemberRepository,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(OPAQUE_TOKEN_SERVICE) private readonly opaqueTokenService: OpaqueTokenService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProviderPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
    private readonly configService: ConfigService,
  ) {}

  async execute(
    command: IssueOrganizationInvitationCommand,
  ): Promise<OrganizationInvitationResult> {
    OrganizationInvitationPolicy.assertRoleIsInvitable(command.role);

    const organizationId = OrganizationId.create(command.organizationId);
    const email = Email.create(command.email).value;

    const existingUser = await this.userRepository.findByEmail(Email.create(email));
    if (existingUser !== null) {
      const existingMembership = await this.memberRepository.findByOrganizationAndUser(
        organizationId,
        existingUser.userId,
      );
      if (existingMembership !== null && existingMembership.isActive()) {
        throw new InvitationTargetAlreadyMemberException();
      }
    }

    const now = this.clock.now();
    const ttlHours = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.organizationInvitationTtlHours,
      DEFAULT_INVITATION_TTL_HOURS,
    );

    const rawToken = this.opaqueTokenService.generate();
    const tokenHash = this.opaqueTokenService.hash(rawToken);

    const invitation = OrganizationInvitation.create({
      id: this.idGenerator.generate(),
      organizationId: organizationId.value,
      email,
      role: command.role,
      tokenHash,
      invitedByUserId: command.actorId,
      status: OrganizationInvitationStatus.Pending,
      expiresAt: new Date(now.getTime() + ttlHours * 3_600_000),
      acceptedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await this.unitOfWork.execute(async () => {
      await this.invitationRepository.revokePendingByOrganizationAndEmail(
        organizationId,
        email,
        now,
      );
      await this.invitationRepository.save(invitation);
    });

    await this.eventPublisher.publish(
      new OrganizationMemberInvitedEvent(
        this.idGenerator.generate(),
        {
          organizationId: organizationId.value,
          actorId: command.actorId,
          invitationId: invitation.id,
          email,
          role: command.role,
        },
        now,
        command.correlationId,
      ),
    );

    await this.sendInvitationEmail(email, rawToken);

    return toOrganizationInvitationResult(invitation, now);
  }

  private async sendInvitationEmail(email: string, rawToken: string): Promise<void> {
    const appConfig = this.configService.get<AppConfig>('app', { infer: true });
    const webBaseUrl = appConfig?.webBaseUrl ?? 'http://localhost:3000';
    const acceptUrl = `${webBaseUrl}/invitations/accept?token=${encodeURIComponent(rawToken)}`;

    const result = await this.emailProvider.send({
      to: email,
      subject: "You've been invited to join an organization on Tavla",
      text: `You've been invited to join an organization on Tavla. Accept your invitation: ${acceptUrl}`,
      html: `<p>You've been invited to join an organization on Tavla.</p><p><a href="${acceptUrl}">Accept your invitation</a></p>`,
    });

    if (result.outcome !== 'sent') {
      // Best-effort (see class doc comment) - never throws into the
      // issuance transaction, which has already committed by this point.
      this.logger.warn(`Invitation email to invitee was not delivered: ${result.reason}`);
    }
  }
}
