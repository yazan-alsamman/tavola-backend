import { Entity } from '@shared/domain/base/entity.base';
import { OrganizationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationMemberRole, OrganizationInvitationStatus } from '../enums/organization.enums';

export interface OrganizationInvitationProps {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationMemberRole;
  tokenHash: string;
  invitedByUserId: string;
  status: OrganizationInvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class OrganizationInvitation extends Entity<OrganizationInvitationProps> {
  private constructor(props: OrganizationInvitationProps) {
    super(props);
  }

  static create(props: OrganizationInvitationProps): OrganizationInvitation {
    return new OrganizationInvitation({ ...props });
  }

  static reconstitute(props: OrganizationInvitationProps): OrganizationInvitation {
    return new OrganizationInvitation({ ...props });
  }

  get organizationId(): OrganizationId {
    return OrganizationId.create(this.props.organizationId);
  }

  get email(): string {
    return this.props.email;
  }

  get role(): OrganizationMemberRole {
    return this.props.role;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get invitedByUserId(): UserId {
    return UserId.create(this.props.invitedByUserId);
  }

  get status(): OrganizationInvitationStatus {
    return this.props.status;
  }

  get expiresAt(): Date {
    return new Date(this.props.expiresAt.getTime());
  }

  get acceptedAt(): Date | null {
    return this.props.acceptedAt ? new Date(this.props.acceptedAt.getTime()) : null;
  }

  isPending(): boolean {
    return this.props.status === OrganizationInvitationStatus.Pending;
  }

  isExpired(now: Date): boolean {
    return this.props.expiresAt.getTime() <= now.getTime();
  }

  revoke(at: Date): OrganizationInvitation {
    return OrganizationInvitation.reconstitute({
      ...this.props,
      status: OrganizationInvitationStatus.Revoked,
      updatedAt: at,
    });
  }

  accept(at: Date): OrganizationInvitation {
    return OrganizationInvitation.reconstitute({
      ...this.props,
      status: OrganizationInvitationStatus.Accepted,
      acceptedAt: at,
      updatedAt: at,
    });
  }

  toProps(): Readonly<OrganizationInvitationProps> {
    return { ...this.props };
  }
}
