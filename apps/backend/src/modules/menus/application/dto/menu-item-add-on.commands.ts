import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

interface BaseAddOnCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  menuId: string;
  categoryId: string;
  itemId: string;
  correlationId?: string;
}

export interface AddOnContentInput {
  name: string;
  price: number;
}

export interface CreateMenuItemAddOnCommand extends BaseAddOnCommand {
  content: AddOnContentInput;
}

export interface UpdateMenuItemAddOnCommand extends BaseAddOnCommand {
  addOnId: string;
  content: AddOnContentInput;
  active: boolean;
}

export interface DeleteMenuItemAddOnCommand extends BaseAddOnCommand {
  addOnId: string;
}
