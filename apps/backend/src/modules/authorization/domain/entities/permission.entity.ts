import { Entity } from '@shared/domain/base/entity.base';
import { PermissionId } from '@shared/domain/value-objects/identifiers.vo';
import { PermissionSlug } from '@shared/domain/value-objects/permission-slug.vo';

export interface PermissionProps {
  id: string;
  slug: string;
  description: string;
  createdAt: Date;
}

export class Permission extends Entity<PermissionProps> {
  private constructor(props: PermissionProps) {
    super(props);
  }

  static create(props: PermissionProps): Permission {
    PermissionSlug.create(props.slug);
    return new Permission({ ...props });
  }

  static reconstitute(props: PermissionProps): Permission {
    return new Permission({ ...props });
  }

  get permissionId(): PermissionId {
    return PermissionId.create(this.props.id);
  }

  get slug(): PermissionSlug {
    return PermissionSlug.create(this.props.slug);
  }

  toProps(): Readonly<PermissionProps> {
    return { ...this.props };
  }
}
