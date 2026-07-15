import { Entity } from '@shared/domain/base/entity.base';
import { EmployeeId, PermissionId, RoleId } from '@shared/domain/value-objects/identifiers.vo';
import { RolePermissionType } from '../enums/authorization.enums';

export interface RolePermissionProps {
  id: string;
  roleId: string | null;
  employeeId: string | null;
  permissionId: string;
  type: RolePermissionType;
  createdAt: Date;
}

export class RolePermission extends Entity<RolePermissionProps> {
  private constructor(props: RolePermissionProps) {
    super(props);
  }

  static create(props: RolePermissionProps): RolePermission {
    RolePermission.validateShape(props);
    return new RolePermission({ ...props });
  }

  static reconstitute(props: RolePermissionProps): RolePermission {
    return new RolePermission({ ...props });
  }

  private static validateShape(props: RolePermissionProps): void {
    if (props.type === RolePermissionType.RoleGrant) {
      if (!props.roleId || props.employeeId) {
        throw new Error('RoleGrant requires roleId and no employeeId.');
      }
      return;
    }
    if (!props.employeeId || props.roleId) {
      throw new Error('Individual overrides require employeeId and no roleId.');
    }
  }

  get type(): RolePermissionType {
    return this.props.type;
  }

  get permissionId(): PermissionId {
    return PermissionId.create(this.props.permissionId);
  }

  get roleId(): RoleId | null {
    return this.props.roleId ? RoleId.create(this.props.roleId) : null;
  }

  get employeeId(): EmployeeId | null {
    return this.props.employeeId ? EmployeeId.create(this.props.employeeId) : null;
  }

  isGrant(): boolean {
    return (
      this.props.type === RolePermissionType.RoleGrant ||
      this.props.type === RolePermissionType.IndividualGrant
    );
  }

  isRevocation(): boolean {
    return this.props.type === RolePermissionType.IndividualRevocation;
  }

  toProps(): Readonly<RolePermissionProps> {
    return { ...this.props };
  }
}
