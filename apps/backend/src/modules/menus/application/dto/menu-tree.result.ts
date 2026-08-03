import { MenuItemAvailabilityMode, MenuItemDietaryLabel } from '../../domain/enums/menu-item.enums';

export interface MenuItemAvailabilityWindowResult {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface MenuItemOptionTreeResult {
  id: string;
  name: string;
  priceModifier: number;
  active: boolean;
  displayOrder: number;
}

export interface MenuItemOptionGroupTreeResult {
  id: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  displayOrder: number;
  options: MenuItemOptionTreeResult[];
}

export interface MenuItemAddOnTreeResult {
  id: string;
  name: string;
  price: number;
  active: boolean;
  displayOrder: number;
}

export interface MenuItemTreeResult {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: number;
  currency: string | null;
  imageUrl: string | null;
  availabilityMode: MenuItemAvailabilityMode;
  isFeatured: boolean;
  preparationTimeMinutes: number | null;
  spicyLevel: number | null;
  calories: number | null;
  allergens: string[];
  dietaryLabels: MenuItemDietaryLabel[];
  displayOrder: number;
  optionGroups: MenuItemOptionGroupTreeResult[];
  addOns: MenuItemAddOnTreeResult[];
  availability: MenuItemAvailabilityWindowResult[];
}

export interface MenuCategoryTreeResult {
  id: string;
  menuId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  displayOrder: number;
  items: MenuItemTreeResult[];
}

export interface MenuTreeResult {
  id: string;
  restaurantId: string;
  name: string;
  active: boolean;
  isDefault: boolean;
  displayOrder: number;
  categories: MenuCategoryTreeResult[];
}
