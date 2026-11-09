export interface MenuResult {
  id: string;
  restaurantId: string;
  /** Null: shared by every branch. */
  branchId: string | null;
  name: string;
  active: boolean;
  isDefault: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
