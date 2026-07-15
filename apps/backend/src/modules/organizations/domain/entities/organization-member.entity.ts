import { Entity } from '@shared/domain/base/entity.base';
import { OrganizationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationMemberRole, OrganizationMemberStatus } from '../enums/organization.enums';
import { SoleOwnerRemovalException } from '../exceptions/sole-owner-removal.exception';
import { OwnershipTransferRequiredException } from '../exceptions/ownership-transfer-required.exception';

export interface OrganizationMemberProps {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationMemberRole;
  invitedAt: Date | null;
  joinedAt: Date | null;
  status: OrganizationMemberStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class OrganizationMember extends Entity<OrganizationMemberProps> {
  private constructor(props: OrganizationMemberProps) {
    super(props);
  }

  static create(props: OrganizationMemberProps): OrganizationMember {
    return new OrganizationMember({ ...props });
  }

  static reconstitute(props: OrganizationMemberProps): OrganizationMember {
    return new OrganizationMember({ ...props });
  }

  get organizationId(): OrganizationId {
    return OrganizationId.create(this.props.organizationId);
  }

  get userId(): UserId {
    return UserId.create(this.props.userId);
  }

  get role(): OrganizationMemberRole {
    return this.props.role;
  }

  get status(): OrganizationMemberStatus {
    return this.props.status;
  }

  isOwner(): boolean {
    return (
      this.props.role === OrganizationMemberRole.Owner &&
      this.props.status === OrganizationMemberStatus.Active
    );
  }

  isActive(): boolean {
    return this.props.status === OrganizationMemberStatus.Active;
  }

  assertCanBeRemoved(activeOwnerCount: number): void {
    if (this.isOwner() && activeOwnerCount <= 1) {
      throw new SoleOwnerRemovalException();
    }
  }

  changeRole(newRole: OrganizationMemberRole, at: Date): OrganizationMember {
    if (this.isOwner() && newRole !== OrganizationMemberRole.Owner) {
      throw new OwnershipTransferRequiredException();
    }
    return OrganizationMember.reconstitute({
      ...this.props,
      role: newRole,
      updatedAt: at,
    });
  }

  remove(at: Date): OrganizationMember {
    return OrganizationMember.reconstitute({
      ...this.props,
      status: OrganizationMemberStatus.Removed,
      updatedAt: at,
    });
  }

  toProps(): Readonly<OrganizationMemberProps> {
    return { ...this.props };
  }
}
