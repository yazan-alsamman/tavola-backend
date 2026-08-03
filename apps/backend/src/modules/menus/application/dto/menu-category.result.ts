export interface MenuCategoryResult {
  id: string;
  menuId: string;
  restaurantId: string;
  name: string;
  description: string | null;
  displayOrder: number;
  imageFileId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
