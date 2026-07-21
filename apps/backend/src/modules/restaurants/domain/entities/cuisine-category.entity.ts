import { Entity } from '@shared/domain/base/entity.base';

export interface CuisineCategoryProps {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Platform-managed reference data (ADR-018, DATABASE_SCHEMA.md "Cuisine
 * Categories") - not tenant-scoped, seeded at deploy via `prisma/seed.ts`.
 * This module only ever reads `CuisineCategory` rows (`reconstitute`); no use
 * case creates or edits one, so no `create()` factory/validation exists here.
 */
export class CuisineCategory extends Entity<CuisineCategoryProps> {
  private constructor(props: CuisineCategoryProps) {
    super(props);
  }

  static reconstitute(props: CuisineCategoryProps): CuisineCategory {
    return new CuisineCategory({ ...props });
  }

  get cuisineCategoryId(): string {
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

  toProps(): Readonly<CuisineCategoryProps> {
    return { ...this.props };
  }
}
