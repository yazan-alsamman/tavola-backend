import { ValueObject } from '@shared/domain/base/value-object.base';
import {
  BranchId,
  OrganizationId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';

export interface ScopeContextProps {
  organizationId: string | null;
  restaurantId: string | null;
  branchId: string | null;
}

export class ScopeContext extends ValueObject<ScopeContextProps> {
  private constructor(props: ScopeContextProps) {
    super(props);
  }

  static create(props: ScopeContextProps): ScopeContext {
    return new ScopeContext({ ...props });
  }

  get organizationId(): OrganizationId | null {
    return this.props.organizationId ? OrganizationId.create(this.props.organizationId) : null;
  }

  get restaurantId(): RestaurantId | null {
    return this.props.restaurantId ? RestaurantId.create(this.props.restaurantId) : null;
  }

  get branchId(): BranchId | null {
    return this.props.branchId ? BranchId.create(this.props.branchId) : null;
  }
}
