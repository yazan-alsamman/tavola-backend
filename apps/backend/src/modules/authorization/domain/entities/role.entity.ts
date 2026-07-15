import { Entity } from '@shared/domain/base/entity.base';
import { RoleId } from '@shared/domain/value-objects/identifiers.vo';
import { RoleSlug } from '@shared/domain/value-objects/role-slug.vo';
import { RoleScope } from '../enums/authorization.enums';

export interface RoleProps {
  id: string;
  name: string;
  slug: string;
  description: string;
  scope: RoleScope;
  createdAt: Date;
  updatedAt: Date;
}

export class Role extends Entity<RoleProps> {
  private constructor(props: RoleProps) {
    super(props);
  }

  static create(props: RoleProps): Role {
    RoleSlug.create(props.slug);
    return new Role({ ...props });
  }

  static reconstitute(props: RoleProps): Role {
    return new Role({ ...props });
  }

  get roleId(): RoleId {
    return RoleId.create(this.props.id);
  }

  get slug(): RoleSlug {
    return RoleSlug.create(this.props.slug);
  }

  get scope(): RoleScope {
    return this.props.scope;
  }

  toProps(): Readonly<RoleProps> {
    return { ...this.props };
  }
}
