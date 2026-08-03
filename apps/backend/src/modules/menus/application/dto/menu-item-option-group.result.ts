export interface MenuItemOptionGroupResult {
  id: string;
  menuItemId: string;
  restaurantId: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
