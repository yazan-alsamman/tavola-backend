import { MenuItemAvailabilityMode, MenuItemDietaryLabel } from '../../domain/enums/menu-item.enums';

export interface MenuItemResult {
  id: string;
  categoryId: string;
  restaurantId: string;
  name: string;
  description: string | null;
  price: number;
  currency: string | null;
  imageFileId: string | null;
  availabilityMode: MenuItemAvailabilityMode;
  isFeatured: boolean;
  preparationTimeMinutes: number | null;
  spicyLevel: number | null;
  calories: number | null;
  allergens: string[];
  dietaryLabels: MenuItemDietaryLabel[];
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
