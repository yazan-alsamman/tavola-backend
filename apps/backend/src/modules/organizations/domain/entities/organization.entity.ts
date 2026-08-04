import { Entity } from '@shared/domain/base/entity.base';
import { OrganizationId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationSlug } from '@shared/domain/value-objects/organization-slug.vo';
import { OrganizationStatus } from '../enums/organization.enums';

export interface OrganizationProps {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  billingEmail: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export class Organization extends Entity<OrganizationProps> {
  private constructor(props: OrganizationProps) {
    super(props);
  }

  static create(props: OrganizationProps): Organization {
    OrganizationSlug.create(props.slug);
    return new Organization({ ...props });
  }

  static reconstitute(props: OrganizationProps): Organization {
    return new Organization({ ...props });
  }

  get organizationId(): OrganizationId {
    return OrganizationId.create(this.props.id);
  }

  get slug(): OrganizationSlug {
    return OrganizationSlug.create(this.props.slug);
  }

  get status(): OrganizationStatus {
    return this.props.status;
  }

  isActive(): boolean {
    return this.props.status === OrganizationStatus.Active && this.props.deletedAt === null;
  }

  isSoftDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  suspend(at: Date): Organization {
    if (this.props.status === OrganizationStatus.Suspended) {
      return this;
    }
    return Organization.reconstitute({
      ...this.props,
      status: OrganizationStatus.Suspended,
      updatedAt: at,
    });
  }

  /**
   * ADR-034 §4 (Phase 19.1). Idempotent, mirroring `Restaurant.activate()`/
   * `suspend()`'s own no-op-if-already-that-state convention. Never touches
   * `Restaurant.status` (§5 - no cascade, ever; a second writer of that field
   * is the exact dual-writer hazard ADR-027 already eliminated for the
   * identical shape of problem).
   */
  reactivate(at: Date): Organization {
    if (this.props.status === OrganizationStatus.Active) {
      return this;
    }
    return Organization.reconstitute({
      ...this.props,
      status: OrganizationStatus.Active,
      updatedAt: at,
    });
  }

  softDelete(at: Date): Organization {
    return Organization.reconstitute({
      ...this.props,
      deletedAt: at,
      updatedAt: at,
    });
  }

  toProps(): Readonly<OrganizationProps> {
    return { ...this.props };
  }
}
