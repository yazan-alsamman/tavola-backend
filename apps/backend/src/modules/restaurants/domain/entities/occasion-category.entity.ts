import { Entity } from '@shared/domain/base/entity.base';

export interface OccasionCategoryProps {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Platform-managed reference data (ADR-018, DATABASE_SCHEMA.md "Occasion
 * Categories") - not tenant-scoped, seeded at deploy via `prisma/seed.ts`.
 * This module only ever reads `OccasionCategory` rows (`reconstitute`); no
 * use case creates or edits one, so no `create()` factory/validation exists
 * here.
 */
export class OccasionCategory extends Entity<OccasionCategoryProps> {
  private constructor(props: OccasionCategoryProps) {
    super(props);
  }

  static reconstitute(props: OccasionCategoryProps): OccasionCategory {
    return new OccasionCategory({ ...props });
  }

  get occasionCategoryId(): string {
    return this.props.id;
  }

  get slug(): string {
    return this.props.slug;
  }

  get name(): string {
    return this.props.name;
  }

  get isActive(): boolean {
    return this.props.isActive;
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

  toProps(): Readonly<OccasionCategoryProps> {
    return { ...this.props };
  }
}
