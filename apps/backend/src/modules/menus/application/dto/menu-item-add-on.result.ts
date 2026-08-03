export interface MenuItemAddOnResult {
  id: string;
  menuItemId: string;
  restaurantId: string;
  name: string;
  price: number;
  active: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
