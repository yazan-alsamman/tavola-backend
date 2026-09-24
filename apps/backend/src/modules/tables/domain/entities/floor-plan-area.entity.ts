import { Entity } from '@shared/domain/base/entity.base';
import { FloorPlanAreaId, FloorPlanId } from '@shared/domain/value-objects/identifiers.vo';
import { HexColor } from '../value-objects/hex-color.vo';
import { InvalidFloorPlanAreaException } from '../exceptions/invalid-floor-plan-area.exception';

export interface FloorPlanAreaProps {
  id: string;
  floorPlanId: string;
  name: string;
  color: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * ADR-040 - a concurrent dining area (hall/section) inside ONE FloorPlan:
 * "Main Hall", "Guests", "Terrace". Child entity of FloorPlan, which is itself
 * a child of the Branch Aggregate Root (DOMAIN_MODEL.md) - so an Area is two
 * levels below its root, and is always reached through its FloorPlan.
 *
 * Deliberately NOT the same axis as `FloorPlan.isActive`: every Area of a
 * FloorPlan is live at the same time, whereas at most one FloorPlan per Branch
 * is active at a time. That invariant is untouched by this entity, which has no
 * activation concept of its own.
 *
 * `color` is stored as the already-normalized `#RRGGBB` string rather than a
 * `HexColor` instance so that `toProps()` stays a plain persistence-shaped
 * record, matching every other entity in this module; construction and every
 * mutation still route the raw input through `HexColor.create`, so an
 * unnormalized value can never enter the entity.
 */
export class FloorPlanArea extends Entity<FloorPlanAreaProps> {
  private constructor(props: FloorPlanAreaProps) {
    super(props);
  }

  static create(props: FloorPlanAreaProps): FloorPlanArea {
    const name = validateName(props.name);
    validateSortOrder(props.sortOrder);
    return new FloorPlanArea({
      ...props,
      name,
      color: HexColor.create(props.color).value,
    });
  }

  static reconstitute(props: FloorPlanAreaProps): FloorPlanArea {
    return new FloorPlanArea({ ...props });
  }

  get floorPlanAreaId(): FloorPlanAreaId {
    return FloorPlanAreaId.create(this.props.id);
  }

  get floorPlanId(): FloorPlanId {
    return FloorPlanId.create(this.props.floorPlanId);
  }

  get name(): string {
    return this.props.name;
  }

  /** Always the normalized uppercase `#RRGGBB` form - see `HexColor`. */
  get color(): string {
    return this.props.color;
  }

  get sortOrder(): number {
    return this.props.sortOrder;
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

  /**
   * Full-replace of the Area's own attributes, matching `Table.updateProfile`'s
   * convention - never `floorPlanId` (an Area cannot migrate between layouts;
   * the tables placed in it are positioned relative to one specific FloorPlan,
   * so moving the Area would silently invalidate every one of them - create an
   * Area in the target plan and move the tables instead).
   */
  updateProfile(
    props: { name: string; color: string; sortOrder: number },
    at: Date,
  ): FloorPlanArea {
    const name = validateName(props.name);
    validateSortOrder(props.sortOrder);
    return FloorPlanArea.reconstitute({
      ...this.props,
      name,
      color: HexColor.create(props.color).value,
      sortOrder: props.sortOrder,
      updatedAt: at,
    });
  }

  softDelete(at: Date): FloorPlanArea {
    return FloorPlanArea.reconstitute({
      ...this.props,
      deletedAt: at,
      updatedAt: at,
    });
  }

  toProps(): Readonly<FloorPlanAreaProps> {
    return { ...this.props };
  }
}

/**
 * Returns the trimmed name rather than only validating it: the uniqueness
 * index is on the stored value, so `"Main Hall"` and `"Main Hall "` must not be
 * able to coexist as two different areas.
 */
function validateName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) {
    throw new InvalidFloorPlanAreaException('name must not be empty.');
  }
  return trimmed;
}

function validateSortOrder(sortOrder: number): void {
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    throw new InvalidFloorPlanAreaException('sortOrder must be a non-negative integer.');
  }
}
