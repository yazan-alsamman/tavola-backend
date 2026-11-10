import { Entity } from '@shared/domain/base/entity.base';
import { FloorPlanAreaId, FloorPlanId } from '@shared/domain/value-objects/identifiers.vo';
import { HexColor } from '../value-objects/hex-color.vo';
import { InvalidFloorPlanAreaException } from '../exceptions/invalid-floor-plan-area.exception';
import { FloorPlanAreaFeature } from '../enums/table.enums';

/**
 * CR WJ-R-2026-002 round 2 (ADR-044): where the area is drawn - its floor
 * (null = ground floor) and its rectangle on the floor-plan grid, in the
 * same canvas units as `Table.positionX/Y`. All-null geometry means the area
 * is a named group only and is not drawn.
 */
export interface FloorPlanAreaLayout {
  floor: number | null;
  positionX: number | null;
  positionY: number | null;
  width: number | null;
  height: number | null;
}

export const EMPTY_AREA_LAYOUT: FloorPlanAreaLayout = {
  floor: null,
  positionX: null,
  positionY: null,
  width: null,
  height: null,
};

export interface FloorPlanAreaProps {
  id: string;
  floorPlanId: string;
  name: string;
  color: string;
  sortOrder: number;
  features: FloorPlanAreaFeature[];
  layout: FloorPlanAreaLayout;
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
    validateLayout(props.layout);
    return new FloorPlanArea({
      ...props,
      name,
      color: HexColor.create(props.color).value,
      features: normalizeFeatures(props.features),
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

  get features(): FloorPlanAreaFeature[] {
    return [...this.props.features];
  }

  get layout(): FloorPlanAreaLayout {
    return { ...this.props.layout };
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
  /**
   * `features`/`layout` left undefined keep their current values, so older
   * clients that only send name/color/sortOrder never wipe them.
   */
  updateProfile(
    props: {
      name: string;
      color: string;
      sortOrder: number;
      features?: FloorPlanAreaFeature[];
      layout?: FloorPlanAreaLayout;
    },
    at: Date,
  ): FloorPlanArea {
    const name = validateName(props.name);
    validateSortOrder(props.sortOrder);
    const layout = props.layout ?? this.props.layout;
    validateLayout(layout);
    return FloorPlanArea.reconstitute({
      ...this.props,
      name,
      color: HexColor.create(props.color).value,
      sortOrder: props.sortOrder,
      features: props.features ? normalizeFeatures(props.features) : this.props.features,
      layout: { ...layout },
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

function normalizeFeatures(features: FloorPlanAreaFeature[]): FloorPlanAreaFeature[] {
  return [...new Set(features)];
}

/** Geometry is all-or-nothing: either a full rectangle with positive size, or none. */
function validateLayout(layout: FloorPlanAreaLayout): void {
  const { floor, positionX, positionY, width, height } = layout;
  if (floor !== null && (!Number.isInteger(floor) || floor < 0)) {
    throw new InvalidFloorPlanAreaException('floor must be a non-negative integer.');
  }
  const geometry = [positionX, positionY, width, height];
  const set = geometry.filter((value) => value !== null).length;
  if (set !== 0 && set !== geometry.length) {
    throw new InvalidFloorPlanAreaException(
      'positionX, positionY, width and height must be set together or all omitted.',
    );
  }
  if (set === 0) return;
  if (
    !Number.isInteger(positionX) ||
    !Number.isInteger(positionY) ||
    positionX! < 0 ||
    positionY! < 0
  ) {
    throw new InvalidFloorPlanAreaException(
      'positionX and positionY must be non-negative integers.',
    );
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width! <= 0 || height! <= 0) {
    throw new InvalidFloorPlanAreaException('width and height must be positive integers.');
  }
}

function validateSortOrder(sortOrder: number): void {
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    throw new InvalidFloorPlanAreaException('sortOrder must be a non-negative integer.');
  }
}
