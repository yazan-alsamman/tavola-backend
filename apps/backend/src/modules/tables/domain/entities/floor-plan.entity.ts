import { Entity } from '@shared/domain/base/entity.base';
import { BranchId, FloorPlanId } from '@shared/domain/value-objects/identifiers.vo';
import { InvalidFloorPlanException } from '../exceptions/invalid-floor-plan.exception';

export interface FloorPlanProps {
  id: string;
  branchId: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * Phase 6.1 - Table Module. Child entity of Branch (not of Table): a Branch
 * may define more than one floor layout over time; only one FloorPlan per
 * Branch is `isActive` at a time (TASKS.md Phase 6.1 decision #5). Mutation
 * of `isActive` is deliberately NOT exposed as an instance method here - the
 * "deactivate every other FloorPlan, activate this one" invariant spans
 * multiple rows and is implemented atomically at the repository layer
 * (`FloorPlanRepository.activate`), the same way
 * `BranchWorkingHoursRepository.replaceAllForBranch` owns its own
 * multi-row transactional behavior rather than the entity.
 */
export class FloorPlan extends Entity<FloorPlanProps> {
  private constructor(props: FloorPlanProps) {
    super(props);
  }

  static create(props: FloorPlanProps): FloorPlan {
    validate(props);
    return new FloorPlan({ ...props });
  }

  static reconstitute(props: FloorPlanProps): FloorPlan {
    return new FloorPlan({ ...props });
  }

  get floorPlanId(): FloorPlanId {
    return FloorPlanId.create(this.props.id);
  }

  get branchId(): BranchId {
    return BranchId.create(this.props.branchId);
  }

  get name(): string {
    return this.props.name;
  }

  get isActive(): boolean {
    return this.props.isActive;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt ? new Date(this.props.deletedAt.getTime()) : null;
  }

  isSoftDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  toProps(): Readonly<FloorPlanProps> {
    return { ...this.props };
  }
}

function validate(props: FloorPlanProps): void {
  if (!props.name || props.name.trim().length === 0) {
    throw new InvalidFloorPlanException('name must not be empty.');
  }
}
